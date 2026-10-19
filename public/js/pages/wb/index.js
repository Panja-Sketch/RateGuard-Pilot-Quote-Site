import { h } from '../../lib/dom.js';
import { role } from '../../lib/api.js';

const TABS = [['#/wb', 'Versions'], ['#/wb/impact', 'Impact & scenarios'], ['#/wb/xlsx', 'XLSX import'], ['#/wb/feedback', 'Feedback'], ['#/wb/audit', 'Audit trail']];

export function wbLayout(activeHref, ...kids) {
  return h('div', null,
    h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Workbench sections' }, TABS.map(([href, label]) => h('a', { href, role: 'tab', 'aria-selected': String(href === activeHref), class: href === activeHref ? 'active' : '', style: { padding: '.6rem .9rem', fontWeight: 600, color: href === activeHref ? 'var(--primary)' : 'var(--muted)', borderBottom: `2px solid ${href === activeHref ? 'var(--primary)' : 'transparent'}`, whiteSpace: 'nowrap' } }, label))),
    ...kids);
}

export const ROLE_HELP = {
  pricing_analyst: 'As a pricing analyst you can create and edit drafts, import workbooks, validate, and submit for approval.',
  pricing_approver: 'As an approver you can approve or reject submissions, promote approved versions and roll back active ones. You cannot approve what you created or submitted.',
  admin: 'As an admin you hold all permissions, but the four-eyes rule still stops you approving a version you created or submitted.',
  agent: 'Agents can read configuration but not change it.',
  api_client: 'API clients can read and validate configuration but not change it.',
};
export const roleHelp = () => ROLE_HELP[role()] || '';

export function registerWorkbenchRoutes(route) {
  const guard = (loader) => async (params, query) => {
    if (!['pricing_analyst', 'pricing_approver', 'admin'].includes(role())) {
      const { notice } = await import('../../lib/dom.js');
      return notice('warn', 'The pricing workbench is available to pricing analysts, approvers and admins. Sign in as a different demo user to explore it.');
    }
    return (await loader())(params, query);
  };
  route('/wb', guard(async () => (await import('./versions.js')).versionsPage));
  route('/wb/v/:id', guard(async () => (await import('./version.js')).versionPage));
  route('/wb/diff/:a/:b', guard(async () => (await import('./diff.js')).diffPage));
  route('/wb/xlsx', guard(async () => (await import('./xlsx.js')).xlsxPage));
  route('/wb/impact', guard(async () => (await import('./impact.js')).impactPage));
  route('/wb/feedback', guard(async () => (await import('./feedback.js')).feedbackPage));
  route('/wb/audit', guard(async () => (await import('./audit.js')).auditPage));
}
