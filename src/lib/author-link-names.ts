/**
 * The names an author link can be given from a list: the sites a theme draws a mark for, as
 * they write their own names, then a website, then a name of the owner's own. The theme reads
 * the mark from the address, never the name, so this only spares the owner some typing.
 */
export const LINK_SITES = ['GitHub', 'X', 'LinkedIn', 'Facebook', 'Instagram', 'YouTube'] as const;

export type LinkNameChoice = (typeof LINK_SITES)[number] | 'website' | 'other';

/** Which choice a stored name is. `website` is the admin's word for one, in its language. */
export function linkNameChoice(label: string, website: string): LinkNameChoice {
  const site = LINK_SITES.find((name) => name === label);
  if (site) return site;
  return label === website ? 'website' : 'other';
}
