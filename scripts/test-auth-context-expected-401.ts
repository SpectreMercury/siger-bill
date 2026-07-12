import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src/contexts/AuthContext.tsx'), 'utf8');
const protectedRoute = readFileSync(
  join(process.cwd(), 'src/components/auth/ProtectedRoute.tsx'),
  'utf8'
);

assert(
  source.includes('ApiError'),
  'AuthContext must inspect ApiError details when refreshUser fails'
);

assert(
  source.includes("error.code === 'AUTH_REQUIRED'") || source.includes('error.status === 401'),
  'AuthContext must recognize expected authentication failures from /me'
);

assert(
  source.includes('if (!isExpectedAuthFailure)'),
  'AuthContext must not console.error expected /me 401 failures'
);

const expectedFailureBranch = source.match(
  /if \(isExpectedAuthFailure\) \{[\s\S]*?clearAuthToken\(\);[\s\S]*?setUser\(null\);[\s\S]*?\}/
);
assert(
  expectedFailureBranch,
  'AuthContext must clear authentication only inside the expected 401 failure branch'
);

const catchBlock = source.match(/\} catch \(error\) \{([\s\S]*?)\} finally/);
assert(catchBlock, 'AuthContext refreshUser catch block must exist');
const catchWithoutExpectedBranch = catchBlock[1].replace(expectedFailureBranch[0], '');
assert(
  !catchWithoutExpectedBranch.includes('clearAuthToken()') &&
    !catchWithoutExpectedBranch.includes('setUser(null)'),
  'Transient /me failures must preserve the current token and user instead of logging out'
);

assert(
  source.includes('authError') && source.includes('setAuthError'),
  'AuthContext must expose a recoverable state when /me fails for a non-auth reason'
);

assert(
  source.includes('const effectiveIsLoading = isLoading;'),
  'A failed /me request must not leave token-without-user in a permanent loading state'
);

assert(
  protectedRoute.includes('authError') && protectedRoute.includes('refreshUser'),
  'ProtectedRoute must render a retry path for transient authentication failures'
);

console.log('auth context expected 401 handling verified.');
