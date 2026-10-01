import { useEffect, useState } from 'react';

import { adminDateFormat, fill, type AdminCopy } from '../../lib/admin-i18n';
import { confirmUi } from '../../lib/ui-dialog';
import type { McpConnectionSummary } from '../../server/mcp/connections';
import BrandMark from '../BrandMark';
import Icon from '../Icon';

const DOCS = 'https://dhanabhon.github.io/tome-cms';

/**
 * Under the MCP card while it is on: the address to give an AI app, and who is connected.
 * Revoking asks first, because the connection stops at once.
 */
export default function McpConnections({ copy, locale }: { copy: AdminCopy; locale: 'en' | 'th' }) {
  const [connections, setConnections] = useState<McpConnectionSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const address = `${typeof location === 'undefined' ? '' : location.origin}/mcp`;
  // The card has no site settings to hand; the browser's own zone is the owner's in practice.
  const dates = adminDateFormat(locale, Intl.DateTimeFormat().resolvedOptions().timeZone);

  useEffect(() => {
    let live = true;
    fetch('/api/admin/mcp/connections')
      .then((response) => (response.ok ? response.json() as Promise<{ connections: McpConnectionSummary[] }> : Promise.reject(new Error())))
      .then((payload) => { if (live) setConnections(payload.connections); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      // The field is selectable; copying by hand still works.
    }
  }

  async function revoke(connection: McpConnectionSummary) {
    const confirmed = await confirmUi({
      cancelLabel: copy.shell.cancel,
      confirmLabel: copy.mcp.revoke,
      message: copy.mcp.revokeBody,
      title: fill(copy.mcp.revokeTitle, { client: connection.clientName }),
      tone: 'danger',
    });
    if (!confirmed) return;
    const response = await fetch('/api/admin/mcp/connections', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: connection.id }),
    });
    if (response.ok) {
      setFailed(false);
      setConnections((current) => (current ?? []).filter(({ id }) => id !== connection.id));
    } else setFailed(true);
  }

  return (
    <div className="mcp-connections">
      <div className="admin-field">
        <label htmlFor="mcp-address">{copy.mcp.address}</label>
        <div className="mcp-connections__address">
          <input className="admin-control" id="mcp-address" onFocus={(event) => event.currentTarget.select()} readOnly value={address} />
          <button className="admin-button admin-button--secondary" onClick={() => void copyAddress()} type="button">
            {copied ? copy.media.urlCopiedShort : copy.mcp.copy}
          </button>
        </div>
        <small>
          <a href={`${DOCS}/${locale === 'th' ? 'th/' : ''}extending/mcp/`} rel="noopener" target="_blank">{copy.mcp.howTo}</a>
        </small>
      </div>
      <h3>{copy.mcp.connections}</h3>
      {failed && <p className="admin-form-error" role="alert">{copy.mcp.failed}</p>}
      {connections?.length === 0 && <p className="mcp-connections__none">{copy.mcp.none}</p>}
      {connections && connections.length > 0 && (
        <ul className="mcp-connections__list">
          {connections.map((connection) => (
            <li key={connection.id}>
              <span aria-hidden="true" className="mcp-connections__mark">
                {connection.brand ? <BrandMark name={connection.brand} /> : <Icon name="system" />}
              </span>
              <div>
                <strong>{connection.clientName}</strong>
                <small>{connection.loopback ? copy.mcp.thisComputer : connection.redirectHost} · {connection.scopes.includes('drafts:write') ? copy.mcp.canWrite : copy.mcp.readOnly}</small>
                <small>
                  {fill(copy.mcp.connected, { date: dates.format(new Date(connection.createdAt)) })} · {connection.lastUsedAt
                    ? fill(copy.mcp.lastUsed, { date: dates.format(new Date(connection.lastUsedAt)) })
                    : copy.mcp.neverUsed}
                </small>
              </div>
              <button className="admin-button admin-button--ghost" onClick={() => void revoke(connection)} type="button">{copy.mcp.revoke}</button>
            </li>
          ))}
        </ul>
      )}
      <small>{copy.mcp.offClears}</small>
    </div>
  );
}
