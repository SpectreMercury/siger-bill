import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Messages = {
  users?: {
    roleLabel?: unknown;
    roles?: unknown;
  };
};

const pageSource = readFileSync(
  join(process.cwd(), 'src/app/(console)/admin/users/page.tsx'),
  'utf8'
);

for (const locale of ['en', 'zh']) {
  const messages = JSON.parse(
    readFileSync(join(process.cwd(), `messages/${locale}.json`), 'utf8')
  ) as Messages;

  assert.equal(
    typeof messages.users?.roleLabel,
    'string',
    `${locale} users.roleLabel must be a string for the users table header`
  );

  assert.equal(
    typeof messages.users?.roles,
    'object',
    `${locale} users.roles must remain the nested role-name message object`
  );
}

assert(
  !pageSource.includes("t('roles')"),
  "Users page must not call t('roles') because users.roles is a nested message object"
);

assert(
  pageSource.includes("t('roleLabel')"),
  'Users page must use users.roleLabel for the roles table header'
);

console.log('users i18n contract verified.');
