/**
 * Lightweight server-side RSS/Atom parser (no external dependencies).
 */

export interface RSSItem {
  title: string
  description: string
  link: string
  pubDate: string
  geoLat?: number
  geoLng?: number
}

/** Strip CDATA wrapper and HTML tags */
function clean(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

/** Extract first occurrence of a tag value */
function tag(xml: string, name: string): string {
  const m = xml.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i')
  )
  return m ? clean(m[1]) : ''
}

export function parseRSSItems(xml: string): RSSItem[] {
  const items: RSSItem[] = []
  // Handle both <item> (RSS) and <entry> (Atom)
  const itemRe = /<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(xml)) !== null) {
    const chunk = m[0]
    // Atom uses <title> and <summary>/<content> and <id> for link
    const title = tag(chunk, 'title')
    const description = tag(chunk, 'summary') || tag(chunk, 'content') || tag(chunk, 'description')
    // Atom <link> may be <link href="..." rel="alternate"/>
    const linkHref = chunk.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ?? ''
    const linkText = tag(chunk, 'link')
    const link = linkHref || linkText
    const pubDate = tag(chunk, 'pubDate') || tag(chunk, 'published') || tag(chunk, 'updated') || ''
    const geoLatStr = tag(chunk, 'geo:lat') || chunk.match(/<geo:lat>([\d.-]+)<\/geo:lat>/i)?.[1]
    const geoLngStr = tag(chunk, 'geo:long') || chunk.match(/<geo:long>([\d.-]+)<\/geo:long>/i)?.[1]
    items.push({
      title,
      description: description.slice(0, 400),
      link,
      pubDate,
      geoLat: geoLatStr ? parseFloat(geoLatStr) : undefined,
      geoLng: geoLngStr ? parseFloat(geoLngStr) : undefined,
    })
  }
  return items
}
