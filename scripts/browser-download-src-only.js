/*
  Minimal browser extractor: download only files under src/ from sourcemaps.

  Usage:
  1) Open world page in browser
  2) Open DevTools Console
  3) Paste and run this script
*/

;(async () => {
  const out = new Map()

  const normalize = p =>
    String(p || '')
      .replace(/\\/g, '/')
      .replace(/^webpack:\/\//i, '')
      .replace(/^file:\/\//i, '')
      .replace(/^[A-Za-z]:\//, '')
      .replace(/^\/+/, '')

  const toSrcPath = p => {
    const n = normalize(p)
    const idx = n.indexOf('src/')
    if (idx === -1) return null
    return n.slice(idx).replace(/^\.\//, '')
  }

  const bundleUrls = new Set()
  document.querySelectorAll('script[src]').forEach(s => {
    try {
      bundleUrls.add(new URL(s.src, location.href).toString())
    } catch {}
  })
  performance.getEntriesByType('resource').forEach(r => {
    if (r?.initiatorType === 'script' || /\.m?js(\?|$)/i.test(r?.name || '')) {
      try {
        bundleUrls.add(new URL(r.name, location.href).toString())
      } catch {}
    }
  })

  const mapUrlFromJs = (jsText, jsUrl) => {
    const re = /\/\/[#@]\s*sourceMappingURL=([^\s]+)/g
    let m, last
    while ((m = re.exec(jsText))) last = m[1]
    if (!last) return null
    if (last.startsWith('data:application/json')) return last
    try {
      return new URL(last, jsUrl).toString()
    } catch {
      return null
    }
  }

  const readMap = async mapUrl => {
    if (mapUrl.startsWith('data:application/json')) {
      const comma = mapUrl.indexOf(',')
      if (comma === -1) return null
      const meta = mapUrl.slice(0, comma)
      const body = mapUrl.slice(comma + 1)
      const text = /;base64/i.test(meta) ? atob(body) : decodeURIComponent(body)
      return JSON.parse(text)
    }
    const res = await fetch(mapUrl, { credentials: 'include' })
    if (!res.ok) return null
    return res.json()
  }

  for (const jsUrl of bundleUrls) {
    try {
      const jsRes = await fetch(jsUrl, { credentials: 'include' })
      if (!jsRes.ok) continue
      const jsText = await jsRes.text()
      const mapUrl = mapUrlFromJs(jsText, jsUrl)
      if (!mapUrl) continue
      const map = await readMap(mapUrl)
      if (!map) continue

      const sources = Array.isArray(map.sources) ? map.sources : []
      const contents = Array.isArray(map.sourcesContent) ? map.sourcesContent : []
      const root = typeof map.sourceRoot === 'string' ? map.sourceRoot : ''

      for (let i = 0; i < sources.length; i++) {
        const src = root ? `${root}/${sources[i]}` : sources[i]
        const srcPath = toSrcPath(src)
        const content = contents[i]
        if (!srcPath || typeof content !== 'string') continue
        if (!out.has(srcPath)) out.set(srcPath, content)
      }
    } catch (err) {
      console.warn('[src-export] skip', jsUrl, err?.message || err)
    }
  }

  if (!out.size) {
    console.warn('[src-export] No src/ files found in sourcemaps.')
    return
  }

  const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')
  const zip = new JSZip()
  for (const [path, content] of out) {
    zip.file(path, content)
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `src-export-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 3000)

  console.log(`[src-export] Downloaded ${out.size} files from src/`)
})()
