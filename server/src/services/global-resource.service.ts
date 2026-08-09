import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export interface GlobalResourceEntry {
  id: string
  name: string
  node: Record<string, unknown>
  ancestors?: Array<Record<string, unknown>>
  assets: Record<string, Record<string, unknown>>
  blobFiles: Record<string, string>
  publishedAt: string
}

type GlobalResourceCatalog = Record<string, GlobalResourceEntry>
type BlobManifest = Record<string, string>

export class GlobalResourceRepository {
  private readonly projectsDir: string
  private readonly libraryDir: string
  private readonly libraryPath: string
  private readonly globalBlobsDir: string

  constructor(private readonly projectRoot: string) {
    this.projectsDir = path.join(projectRoot, 'projects')
    this.libraryDir = path.join(projectRoot, 'resources')
    this.libraryPath = path.join(this.libraryDir, 'library.json')
    this.globalBlobsDir = path.join(this.libraryDir, 'blobs')
  }

  list(): GlobalResourceEntry[] {
    const catalog = this.readCatalog()
    if (this.migrateLegacyAncestorPaths(catalog)) this.writeCatalog(catalog)
    return Object.values(catalog)
  }

  writeStagedBlob(resourceId: string, key: string, data: Buffer): void {
    fs.mkdirSync(this.globalBlobsDir, { recursive: true })
    fs.writeFileSync(this.globalBlobPath(resourceId, key), data)
  }

  publish(input: {
    id: string
    name: string
    node: Record<string, unknown>
    ancestors?: Array<Record<string, unknown>>
    assets: Record<string, Record<string, unknown>>
    blobKeys: string[]
  }): GlobalResourceEntry {
    const catalog = this.readCatalog()
    if (catalog[input.id]) throw new Error('Resource is already global')
    const blobFiles: Record<string, string> = {}
    for (const key of input.blobKeys) {
      const filePath = this.globalBlobPath(input.id, key)
      if (!fs.existsSync(filePath)) throw new Error(`Global Resource blob upload is incomplete: ${key}`)
      blobFiles[key] = path.basename(filePath)
    }
    const entry: GlobalResourceEntry = {
      id: input.id,
      name: input.name,
      node: input.node,
      assets: input.assets,
      blobFiles,
      publishedAt: new Date().toISOString(),
    }
    if (input.ancestors) entry.ancestors = input.ancestors
    catalog[input.id] = entry
    this.writeCatalog(catalog)
    return entry
  }

  remove(resourceId: string): boolean {
    const catalog = this.readCatalog()
    const entry = catalog[resourceId]
    if (!entry) return false
    for (const fileName of Object.values(entry.blobFiles)) {
      const filePath = path.join(this.globalBlobsDir, path.basename(fileName))
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }
    delete catalog[resourceId]
    this.writeCatalog(catalog)
    return true
  }

  updateAncestors(resourceId: string, ancestors: Array<Record<string, unknown>>): boolean {
    const catalog = this.readCatalog()
    const entry = catalog[resourceId]
    if (!entry) return false
    for (const ancestor of ancestors) validatePathFolder(ancestor)
    entry.ancestors = structuredClone(ancestors)
    this.writeCatalog(catalog)
    return true
  }

  syncProject(projectName: string): { added: string[]; globalIds: string[] } {
    const catalog = this.readCatalog()
    if (this.migrateLegacyAncestorPaths(catalog)) this.writeCatalog(catalog)
    const globalIds = Object.keys(catalog)
    const projectDir = path.join(this.projectsDir, sanitizeName(projectName))
    const projectPath = path.join(projectDir, 'project.json')
    if (!fs.existsSync(projectPath)) throw new Error('Project not found')
    const project = JSON.parse(fs.readFileSync(projectPath, 'utf-8'))
    const tree = project?.objectTree
    if (!tree?.root) return { added: [], globalIds }
    const resourceFolder = findNode(tree?.root, 'project:/resource')
    if (!resourceFolder || resourceFolder.kind !== 'folder' || !Array.isArray(resourceFolder.children)) {
      throw new Error('Project Resource folder is missing')
    }

    const added: string[] = []
    for (const entry of Object.values(catalog)) {
      let treeChanged = false
      let destination = resourceFolder
      for (const ancestor of entry.ancestors ?? []) {
        destination = ensurePathFolder(destination, ancestor)
      }
      const locations = findNodeLocations(resourceFolder, entry.id)
      const destinationLocation = locations.find(location => location.parent === destination)
      let existing = destinationLocation?.node ?? locations[0]?.node ?? null
      if (existing && !destinationLocation) {
        const source = locations[0]
        const sourceIndex = source.parent.children.indexOf(existing)
        if (sourceIndex >= 0) source.parent.children.splice(sourceIndex, 1)
        destination.children.push(existing)
        treeChanged = true
      }
      for (const duplicate of locations) {
        if (duplicate.node === existing) continue
        if (existing) mergeFolderTree(existing, duplicate.node)
        const duplicateIndex = duplicate.parent.children.indexOf(duplicate.node)
        if (duplicateIndex >= 0) duplicate.parent.children.splice(duplicateIndex, 1)
        treeChanged = true
      }
      if (existing) {
        if (mergeFolderTree(existing, entry.node)) treeChanged = true
        const assetsPresent = Object.keys(entry.assets).every(assetId => tree.assets?.[assetId])
        if (!treeChanged && assetsPresent) continue
      } else {
        destination.children.push(structuredClone(entry.node))
        treeChanged = true
      }
      for (const [key, fileName] of Object.entries(entry.blobFiles)) {
        const sourcePath = path.join(this.globalBlobsDir, path.basename(fileName))
        if (!fs.existsSync(sourcePath)) throw new Error(`Global Resource blob is missing: ${key}`)
        copyProjectBlob(projectDir, key, sourcePath)
      }
      for (const [assetId, asset] of Object.entries(entry.assets)) {
        tree.assets[assetId] = structuredClone(asset)
      }
      added.push(entry.id)
    }

    if (added.length > 0) {
      project.modifiedAt = new Date().toISOString()
      fs.writeFileSync(projectPath, JSON.stringify(project, null, 2))
    }
    return { added, globalIds }
  }

  private migrateLegacyAncestorPaths(catalog: GlobalResourceCatalog): boolean {
    let changed = false
    for (const entry of Object.values(catalog)) {
      if (Array.isArray(entry.ancestors)) continue
      let best: Array<Record<string, unknown>> = []
      for (const container of Object.values(catalog)) {
        if (container.id === entry.id) continue
        const candidate = findAncestorPath(container.node, entry.id)
        if (candidate && candidate.length > best.length) best = candidate
      }
      if (fs.existsSync(this.projectsDir)) {
        for (const projectEntry of fs.readdirSync(this.projectsDir, { withFileTypes: true })) {
          if (!projectEntry.isDirectory()) continue
          const projectPath = path.join(this.projectsDir, projectEntry.name, 'project.json')
          if (!fs.existsSync(projectPath)) continue
          try {
            const project = JSON.parse(fs.readFileSync(projectPath, 'utf-8'))
            const resource = findNode(project?.objectTree?.root, 'project:/resource')
            for (const child of Array.isArray(resource?.children) ? resource.children : []) {
              const candidate = findAncestorPath(child, entry.id)
              if (candidate && candidate.length > best.length) best = candidate
            }
          } catch {
            // A malformed project should not block syncing unrelated resources.
          }
        }
      }
      entry.ancestors = best
      changed = true
    }
    return changed
  }

  private globalBlobPath(resourceId: string, key: string): string {
    const hash = crypto.createHash('sha256').update(`${resourceId}\0${key}`).digest('hex')
    return path.join(this.globalBlobsDir, `${hash}.blob`)
  }

  private readCatalog(): GlobalResourceCatalog {
    if (!fs.existsSync(this.libraryPath)) return {}
    try {
      const parsed = JSON.parse(fs.readFileSync(this.libraryPath, 'utf-8'))
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  private writeCatalog(catalog: GlobalResourceCatalog): void {
    fs.mkdirSync(this.libraryDir, { recursive: true })
    fs.writeFileSync(this.libraryPath, JSON.stringify(catalog, null, 2))
  }
}

function ensurePathFolder(parent: any, ancestor: Record<string, unknown>): any {
  validatePathFolder(ancestor)
  const existing = parent.children.find((child: any) => child?.id === ancestor.id)
  if (existing) {
    if (existing.kind !== 'folder' || !Array.isArray(existing.children)) {
      throw new Error(`Global Resource path conflicts with a non-folder node: ${ancestor.name}`)
    }
    return existing
  }
  const folder = { ...structuredClone(ancestor), kind: 'folder', children: [] }
  parent.children.push(folder)
  return folder
}

function validatePathFolder(ancestor: Record<string, unknown>): void {
  if (ancestor.kind !== 'folder' || typeof ancestor.id !== 'string' || typeof ancestor.name !== 'string') {
    throw new Error('Global Resource ancestor path is invalid')
  }
}

function findAncestorPath(node: any, targetId: string, ancestors: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> | null {
  if (!node || typeof node !== 'object') return null
  if (node.id === targetId) return ancestors
  const nextAncestors = node.kind === 'folder'
    ? [...ancestors, { id: node.id, kind: 'folder', name: String(node.name || node.id), children: [] }]
    : ancestors
  for (const child of Array.isArray(node.children) ? node.children : []) {
    const found = findAncestorPath(child, targetId, nextAncestors)
    if (found) return found
  }
  return null
}

function mergeFolderTree(existing: any, incoming: Record<string, unknown>): boolean {
  if (existing?.kind !== 'folder' || incoming.kind !== 'folder' || !Array.isArray(existing.children)) return false
  let changed = false
  for (const child of Array.isArray(incoming.children) ? incoming.children : []) {
    const current = existing.children.find((candidate: any) => candidate?.id === child?.id)
    if (!current) {
      existing.children.push(structuredClone(child))
      changed = true
    } else if (mergeFolderTree(current, child)) {
      changed = true
    }
  }
  return changed
}

function findNode(node: any, id: string): any | null {
  if (!node || typeof node !== 'object') return null
  if (node.id === id) return node
  for (const child of Array.isArray(node.children) ? node.children : []) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

function findNodeLocations(parent: any, id: string, found: Array<{ parent: any; node: any }> = []): Array<{ parent: any; node: any }> {
  for (let index = 0; index < (Array.isArray(parent?.children) ? parent.children.length : 0); index++) {
    const child = parent.children[index]
    if (child?.id === id) found.push({ parent, node: child })
    findNodeLocations(child, id, found)
  }
  return found
}

function copyProjectBlob(projectDir: string, key: string, sourcePath: string): void {
  const bDir = path.join(projectDir, 'blobs')
  const manifestPath = path.join(bDir, 'manifest.json')
  fs.mkdirSync(bDir, { recursive: true })
  const manifest = readManifest(manifestPath)
  const existing = Object.entries(manifest).find(([, originalKey]) => originalKey === key)?.[0]
  const fileName = existing ?? `${crypto.createHash('sha256').update(key).digest('hex').slice(0, 40)}.blob`
  fs.copyFileSync(sourcePath, path.join(bDir, fileName))
  manifest[fileName] = key
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
}

function readManifest(manifestPath: string): BlobManifest {
  if (!fs.existsSync(manifestPath)) return {}
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 60)
}
