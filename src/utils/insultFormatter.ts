/**
 * Formats insult frequency pairs with consistent layout
 * Shows pairs with max 35 characters per line and proper line breaks
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

  const MAX_LINE_LENGTH = 35;
  const MAX_TOTAL_LENGTH = 1000;
  
  let buffer = '';
  let totalUsed = 0;
  let currentLineLength = 0;
  let added = 0;

  for (let i = 0; i < distinctPairs.length; i++) {
    const part = distinctPairs[i];
    const sep = currentLineLength === 0 ? '' : ', ';
    const prospective = sep + part;
    const prospectiveLen = prospective.length;
    
    // Check if adding this item would exceed total limit
    if (totalUsed + prospectiveLen > MAX_TOTAL_LENGTH) break;
    
    // Check if adding this item would exceed line length
    if (currentLineLength + prospectiveLen > MAX_LINE_LENGTH) {
      // If current line is not empty, add line break
      if (currentLineLength > 0) {
        if (totalUsed + 1 > MAX_TOTAL_LENGTH) break; // Check if we have room for '\n'
        buffer += '\n';
        totalUsed += 1;
        currentLineLength = 0;
        // Reset separator for new line
        const newProspective = part;
        const newProspectiveLen = newProspective.length;
        
        // Check if even a single item exceeds line length
        if (newProspectiveLen > MAX_LINE_LENGTH) {
          // If single item exceeds line length, add it anyway (as per requirement)
          buffer += newProspective;
          totalUsed += newProspectiveLen;
          currentLineLength = newProspectiveLen;
        } else {
          buffer += newProspective;
          totalUsed += newProspectiveLen;
          currentLineLength = newProspectiveLen;
        }
      } else {
        // Current line is empty, add the item even if it exceeds line length
        buffer += part;
        totalUsed += part.length;
        currentLineLength = part.length;
      }
    } else {
      // Add to current line
      buffer += prospective;
      totalUsed += prospectiveLen;
      currentLineLength += prospectiveLen;
    }
    
    added++;
  }

  const remaining = distinctPairs.length - added;
  return remaining > 0 ? `${buffer} … (+${remaining} more)` : buffer;
}
