/**
 * Formats insult frequency pairs with consistent layout
 * Shows 4 pairs per line with proper line breaks and truncation
 */
export function formatInsultFrequencyPairs(insultGroups: Array<{ insult: string; _count: { insult: number } }>): string {
  if (insultGroups.length === 0) {
    return '—';
  }

  // Sort by count descending, then by insult ascending
  const sortedGroups = insultGroups
    .sort((a, b) => (b._count.insult - a._count.insult) || a.insult.localeCompare(b.insult));

  // Create pairs in format "insult(count)"
  const distinctPairs = sortedGroups.map((g) => `${g.insult}(${g._count.insult})`);

  let buffer = '';
  let used = 0;
  let itemsOnLine = 0;
  let added = 0;

  for (let i = 0; i < distinctPairs.length; i++) {
    const part = distinctPairs[i];
    const sep = itemsOnLine === 0 ? '' : ', ';
    const prospective = sep + part;
    const prospectiveLen = prospective.length;
    
    // Check if adding this item would exceed the limit
    if (used + prospectiveLen > 1000) break;
    
    buffer += prospective;
    used += prospectiveLen;
    itemsOnLine++;
    added++;
    
    // Add line break after 4 items (not on the last item)
    if (itemsOnLine === 4 && i !== distinctPairs.length - 1) {
      if (used + 1 > 1000) break; // Check if we have room for '\n'
      buffer += '\n';
      used += 1;
      itemsOnLine = 0;
    }
  }

  const remaining = distinctPairs.length - added;
  return remaining > 0 ? `${buffer} … (+${remaining} more)` : buffer;
}
