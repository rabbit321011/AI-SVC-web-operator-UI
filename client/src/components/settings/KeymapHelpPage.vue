<template>
  <div class="keymap-page">
    <header class="keymap-head">
      <h1>键位教学</h1>
      <p>常用键位和鼠标组合。</p>
    </header>

    <section class="keyboard" aria-label="Keyboard shortcuts">
      <div class="key wide">Alt<span>定位 / 横向快移</span></div>
      <div class="key wide">Ctrl<span>纵向浏览 / 移轨</span></div>
      <div class="key">N<span>TrackObject</span></div>
      <div class="key">L<span>AudioObject</span></div>
      <div class="key">M<span>MidiObject</span></div>
      <div class="key">K<span>TextObject</span></div>
      <div class="key space">Mouse Wheel<span>时间线滚动</span></div>
    </section>

    <section class="shortcut-list">
      <div class="shortcut"><kbd>Alt</kbd><span>+</span><kbd>Wheel</kbd><strong>快速横向移动 timeline</strong></div>
      <div class="shortcut"><kbd>Ctrl</kbd><span>+</span><kbd>Wheel</kbd><strong>上下浏览不同音轨</strong></div>
      <div class="shortcut"><kbd>Ctrl</kbd><span>+</span><kbd>↑</kbd><strong>选中片段上移到上一音轨</strong></div>
      <div class="shortcut"><kbd>Ctrl</kbd><span>+</span><kbd>↓</kbd><strong>选中片段下移到下一音轨</strong></div>
      <div class="shortcut"><kbd>Alt</kbd><span>+</span><kbd>N</kbd><strong>定位 TrackObject</strong></div>
      <div class="shortcut"><kbd>Alt</kbd><span>+</span><kbd>L</kbd><strong>定位 AudioObject</strong></div>
      <div class="shortcut"><kbd>Alt</kbd><span>+</span><kbd>M</kbd><strong>定位关联 MidiObject</strong></div>
      <div class="shortcut"><kbd>Alt</kbd><span>+</span><kbd>K</kbd><strong>定位关联 TextObject</strong></div>
    </section>
  </div>
</template>

<style scoped>
.keymap-page {
  flex: 1;
  overflow: auto;
  padding: 24px 28px;
  color: var(--app-text);
}
.keymap-head {
  margin-bottom: 20px;
}
.keymap-head h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 650;
}
.keymap-head p {
  margin: 0;
  color: var(--app-muted);
  font-size: 13px;
}
.keyboard {
  max-width: 760px;
  display: grid;
  grid-template-columns: repeat(6, minmax(72px, 1fr));
  gap: 8px;
  padding: 18px;
  border: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-panel) 88%, transparent);
}
.key {
  min-height: 58px;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  background: var(--app-surface);
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 8px;
  font-size: 18px;
  font-weight: 700;
}
.key span {
  margin-top: 5px;
  font-size: 10px;
  font-weight: 500;
  color: var(--app-muted);
}
.key.wide { grid-column: span 2; }
.key.space { grid-column: span 4; }
.shortcut-list {
  max-width: 760px;
  display: grid;
  gap: 8px;
  margin-top: 18px;
}
.shortcut {
  display: grid;
  grid-template-columns: auto auto auto 1fr;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--app-border);
}
kbd {
  min-width: 34px;
  padding: 4px 8px;
  border: 1px solid var(--app-border);
  border-radius: 5px;
  background: var(--app-surface);
  font: inherit;
  font-size: 12px;
  text-align: center;
}
.shortcut strong {
  font-size: 13px;
  font-weight: 500;
}
</style>
