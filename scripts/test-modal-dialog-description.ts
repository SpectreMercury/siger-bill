import { readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

const modalSource = readFileSync(join(process.cwd(), 'src/components/ui/Modal.tsx'), 'utf8');

assert(
  modalSource.includes('DialogDescription'),
  'Modal must render DialogDescription to avoid Radix DialogContent accessibility warnings'
);

assert(
  modalSource.includes('className="sr-only"'),
  'Modal dialog description should stay visually hidden when callers do not provide visible copy'
);

console.log('modal dialog description safeguard verified.');
