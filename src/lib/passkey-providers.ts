export type PasskeyProvider =
  | 'google' | 'icloud' | 'chrome-mac' | 'windows-hello' | '1password' | 'bitwarden'
  | 'dashlane' | 'samsung-pass' | 'proton-pass' | 'keepassxc' | 'security-key';

const PROVIDER_AAGUIDS: Record<Exclude<PasskeyProvider, 'security-key'>, readonly string[]> = {
  google: ['ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4'],
  icloud: ['fbfc3007-154e-4ecc-8c0b-6e020557d7bd', 'dd4ec289-e01d-41c9-bb89-70fa845d4bf2'],
  'chrome-mac': ['adce0002-35bc-c60a-648b-0b25f1f05503'],
  'windows-hello': [
    '08987058-cadc-4b81-b6e1-30de50dcbe96',
    '9ddd1817-af5a-4672-a2b9-3e3dd95000a9',
    '6028b017-b1d4-4c02-b4b3-afcdafc96bb2',
  ],
  '1password': ['bada5566-a7aa-401f-bd96-45619a55120d'],
  bitwarden: ['d548826e-79b4-db40-a3d8-11116f7e8349'],
  dashlane: ['531126d6-e717-415c-9320-3d9aa6981239'],
  'samsung-pass': ['53414d53-554e-4700-0000-000000000000'],
  'proton-pass': ['50726f74-6f6e-5061-7373-50726f746f6e'],
  keepassxc: ['fdb141b2-5d84-443e-8a35-4698c205a502'],
};

const BY_AAGUID = new Map<string, PasskeyProvider>(
  Object.entries(PROVIDER_AAGUIDS).flatMap(([provider, aaguids]) => aaguids.map((aaguid) => [aaguid, provider as PasskeyProvider] as const)),
);

/** Where a passkey lives, from its AAGUID; an unknown one reached over usb or nfc is a security key. */
export function passkeyProvider(aaguid: string | null, transports: string | null): PasskeyProvider | null {
  const known = aaguid ? BY_AAGUID.get(aaguid.toLowerCase()) : undefined;
  if (known) return known;
  return (transports ?? '').split(',').map((transport) => transport.trim().toLowerCase()).some((transport) => transport === 'usb' || transport === 'nfc') ? 'security-key' : null;
}
