import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export interface GlobalResourceEntry {
  id: string
  name: string
  node: Record<string, unknown>
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
    return Object.values(this.readCatalog())
  }

  writeStagedBlob(resourceId: string, key: string, data: Buffer): void {
    fs.mkdirSync(this.globalBlobsDir, { recursive: true })
    fs.writeFileSync(this.globalBlobPath(resourceId, key), data)
  }

  publish(input: {
    id: string
    name: string
    node: Record<string, unknown>
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

  syncProject(projectName: string): { added: string[]; globalIds: string[] } {
    const catalog = this.readCatalog()
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
      if (findNode(tree.root, entry.id)) continue
      for (const [key, fileName] of Object.entries(entry.blobFiles)) {
        const sourcePath = path.join(this.globalBlobsDir, path.basename(fileName))
        if (!fs.existsSync(sourcePath)) throw new Error(`Global Resource blob is missing: ${key}`)
        copyProjectBlob(projectDir, key, sourcePath)
      }
      for (const [assetId, asset] of Object.entries(entry.assets)) {
        tree.assets[assetId] = structuredClone(asset)
      }
      resourceFolder.children.push(structuredClone(entry.node))
      added.push(entry.id)
    }

    if (added.length > 0) {
      project.modifiedAt = new Date().toISOString()
      fs.writeFileSync(projectPath, JSON.stringify(project, null, 2))
    }
    return { added, globalIds }
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

function findNode(node: any, id: string): any | null {
  if (!node || typeof node !== 'object') return null
  if (node.id === id) return node
  for (const child of Array.isArray(node.children) ? node.children : []) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
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
