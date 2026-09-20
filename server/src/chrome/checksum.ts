import crypto from 'node:crypto'

/**
 * Reproduces Chrome's own bookmark checksum (`BookmarkCodec` in Chromium).
 *
 * Chrome stores an MD5 over the tree and compares it on load. Writing the file
 * without updating it makes Chrome treat the file as externally modified, so
 * anything written back has to re-sign it.
 *
 * The hash is fed, depth-first over bookmark_bar / other / synced:
 *   folder -> id, title, "folder", then its children
 *   url    -> id, title, "url", url
 * with ids and urls as UTF-8 and titles as UTF-16LE, exactly as Chromium does.
 */
interface RawNode {
  id?: string
  guid?: string
  name?: string
  type?: string
  url?: string
  children?: RawNode[]
}

const ROOT_KEYS = ['bookmark_bar', 'other', 'synced'] as const

export function computeChecksum(roots: Record<string, RawNode>): string {
  const md5 = crypto.createHash('md5')

  const utf8 = (value: string) => md5.update(Buffer.from(value, 'utf8'))
  const utf16 = (value: string) => md5.update(Buffer.from(value, 'utf16le'))

  const walk = (node: RawNode) => {
    const id = node.id ?? ''
    const title = node.name ?? ''

    if (node.type === 'url' || (node.url !== undefined && !node.children)) {
      utf8(id)
      utf16(title)
      utf8('url')
      utf8(node.url ?? '')
      return
    }

    utf8(id)
    utf16(title)
    utf8('folder')
    for (const child of node.children ?? []) walk(child)
  }

  for (const key of ROOT_KEYS) {
    const root = roots[key]
    if (root) walk(root)
  }

  return md5.digest('hex')
}

/** True when the file's stored checksum matches what Chrome would compute. */
export function verifyChecksum(json: {
  roots: Record<string, RawNode>
  checksum?: string
}): boolean {
  return typeof json.checksum === 'string' && computeChecksum(json.roots) === json.checksum
}
