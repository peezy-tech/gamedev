/**
 *
 * Hash File
 *
 * takes a file and generates a sha256 unique hash.
 * carefully does this the same way as the server function.
 *
 */
export async function hashFile(file) {
  const buf = await file.arrayBuffer()
  const hashBuf = await crypto.subtle.digest('SHA-256', buf)
  const hash = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return hash
}

export function navigateToServer(wsUrl) {
  const url = new URL(location.href)
  url.searchParams.delete('mode')
  if (wsUrl) {
    url.searchParams.set('connect', wsUrl)
  } else {
    url.searchParams.delete('connect')
  }
  location.href = url.toString()
}
