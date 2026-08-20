import { randomBytes } from 'crypto';
import type * as vscode from 'vscode';

export interface SecureWebviewHtmlOptions {
  enableScripts?: boolean;
  allowInlineEventHandlers?: boolean;
  /** 允许的 iframe 来源列表；缺省为 'none'（完全禁止内嵌） */
  frameSrc?: string[];
}

const CSP_META_PATTERN = /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*["']Content-Security-Policy["'])[^>]*>\s*/gi;
const SCRIPT_TAG_PATTERN = /<script\b([^>]*)>/gi;
const NONCE_ATTRIBUTE_PATTERN = /\snonce\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

export function secureWebviewHtml(
  webview: Pick<vscode.Webview, 'cspSource'>,
  html: string,
  options: SecureWebviewHtmlOptions = {}
): string {
  const enableScripts = options.enableScripts !== false;
  const nonce = randomBytes(18).toString('hex');
  const scriptSource = enableScripts ? `'nonce-${nonce}'` : "'none'";
  const scriptAttributes = enableScripts && options.allowInlineEventHandlers
    ? "'unsafe-inline'"
    : "'none'";
  const frameSource = options.frameSrc && options.frameSrc.length > 0
    ? options.frameSrc.join(' ')
    : "'none'";
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data: blob:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource} data:`,
    `media-src ${webview.cspSource} data: blob:`,
    `script-src ${scriptSource}`,
    `script-src-elem ${scriptSource}`,
    `script-src-attr ${scriptAttributes}`,
    "connect-src 'none'",
    "worker-src 'none'",
    `frame-src ${frameSource}`,
  ].join('; ') + ';';
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;

  let secured = html.replace(CSP_META_PATTERN, '');
  if (enableScripts) {
    secured = secured.replace(SCRIPT_TAG_PATTERN, (_match, attributes: string) => {
      const safeAttributes = attributes.replace(NONCE_ATTRIBUTE_PATTERN, '');
      return `<script nonce="${nonce}"${safeAttributes}>`;
    });
  }

  if (/<head\b[^>]*>/i.test(secured)) {
    return secured.replace(/<head\b([^>]*)>/i, `<head$1>${meta}`);
  }
  if (/<html\b[^>]*>/i.test(secured)) {
    return secured.replace(/<html\b([^>]*)>/i, `<html$1><head>${meta}</head>`);
  }
  return `<!DOCTYPE html><html><head>${meta}</head><body>${secured}</body></html>`;
}
