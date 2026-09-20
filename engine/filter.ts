import { ProviderError } from './errors.ts';
export function filterSql(params: URLSearchParams, now = new Date()) {
  const where: string[] = [], values: (string | number)[] = [];
  for (const token of (params.get('q') || '').trim().split(/\s+/).filter(Boolean)) { where.push('instr(v.search_text, ?) > 0'); values.push(token.toLocaleLowerCase()); }
  if (params.get('uploader')) { where.push('instr(v.uploader_search, ?) > 0'); values.push(params.get('uploader')!.toLocaleLowerCase()); }
  if (params.get('provider')) { where.push('v.provider = ?'); values.push(params.get('provider')!); }
  const rating = '(CASE WHEN v.rating_scale > 0 THEN 100.0 * v.rating / v.rating_scale END)';
  for (const [name,col] of Object.entries({Views:'v.views',Likes:'v.likes',Comments:'v.comments',Rating:rating,Duration:'v.duration_seconds'})) {
    const bounds: number[] = [];
    for (const [bound,op] of [['min','>='],['max','<=']]) {
      const raw = params.get(bound + name); if (raw === null || raw === '') continue;
      const n = Number(raw); if (!Number.isFinite(n) || n < 0) throw new ProviderError('invalid_filter', `${bound}${name} must be a nonnegative number.`, 400);
      where.push(`${col} ${op} ?`); values.push(n); bounds.push(n);
    }
    if (bounds.length === 2 && bounds[0] > bounds[1]) throw new ProviderError('invalid_filter', `Minimum ${name.toLowerCase()} exceeds maximum.`, 400);
  }
  let from = params.get('from'), to = params.get('to');
  const period = params.get('period');
  if (period && !['all','custom'].includes(period)) {
    if (!['today','7','30','365'].includes(period)) throw new ProviderError('invalid_filter', 'Unknown upload period.', 400);
    // Explicit client-local UTC bounds take precedence for calendar periods.
    if (!from && !to) { const end = new Date(now); end.setUTCHours(24,0,0,0); const start = new Date(end); start.setUTCDate(start.getUTCDate() - (period === 'today' ? 1 : Number(period))); from = start.toISOString(); to = end.toISOString(); }
  }
  for (const [raw,op,end] of [[from,'>=',false],[to,'<',true]] as const) if (raw) {
    let time = Date.parse(raw);
    if (!Number.isFinite(time)) throw new ProviderError('invalid_filter', 'Invalid date boundary.', 400);
    if (end && /^\d{4}-\d{2}-\d{2}$/.test(raw)) time += 86400000;
    where.push(`v.published_at ${op} ?`); values.push(new Date(time).toISOString());
  }
  if (params.get('hd') === 'true') where.push('v.is_hd = 1');
  if (params.get('hasThumbnail') === 'true') where.push("v.thumbnail_url IS NOT NULL AND v.thumbnail_url != ''");
  if (params.get('knownViews') === 'true') where.push('v.views IS NOT NULL');
  if (params.get('download') === 'true') where.push('0 = 1');
  if (params.get('resolution')) { const n = Number(params.get('resolution')); if (!Number.isFinite(n) || n <= 0) throw new ProviderError('invalid_filter', 'Resolution must be a positive pixel height.', 400); where.push('v.height >= ?'); values.push(n); }
  const sorts: Record<string,string> = {views:'v.views',likes:'v.likes',comments:'v.comments',rating,published:'v.published_at',duration:'v.duration_seconds',title:'v.title COLLATE NOCASE'};
  const mode = params.get('sort') || 'views_desc', match = mode.match(/^(views|likes|comments|rating|published|duration|title)_(asc|desc)$/);
  if (!match) throw new ProviderError('invalid_filter', 'Unknown sort order.', 400);
  const column = sorts[match[1]], order = `(${column}) IS NULL ASC, ${column} ${match[2].toUpperCase()}, v.id ASC`;
  const pageSize = Number(params.get('pageSize') || 24), page = Number(params.get('page') || 1);
  if (![24,48,96].includes(pageSize) || !Number.isInteger(page) || page < 1 || !Number.isSafeInteger((page-1)*pageSize)) throw new ProviderError('invalid_filter', 'Use page sizes 24, 48 or 96 and a positive page.', 400);
  return {where: where.length ? ' AND ' + where.join(' AND ') : '', values, order, page, pageSize, offset: (page - 1)*pageSize};
}
