const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function segmentOrder(a: string, b: string) {
  const left = a.normalize('NFC').toLowerCase().match(/[0-9]+|[^0-9]+/g) ?? [];
  const right = b.normalize('NFC').toLowerCase().match(/[0-9]+|[^0-9]+/g) ?? [];
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const x = left[index]; const y = right[index];
    if (/^[0-9]+$/.test(x) && /^[0-9]+$/.test(y)) {
      const nx = x.replace(/^0+/, '') || '0'; const ny = y.replace(/^0+/, '') || '0';
      const order = nx.length - ny.length || compare(nx, ny) || x.length - y.length;
      if (order) return order;
    } else {
      const order = compare(x, y);
      if (order) return order;
    }
  }
  return left.length - right.length;
}

// Independent of OS locale/ICU: compare each directory component before its children.
export function comparePagePaths(a: string, b: string) {
  const left = a.split('/'); const right = b.split('/');
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const order = segmentOrder(left[index], right[index]);
    if (order) return order;
  }
  return left.length - right.length || compare(a.normalize('NFC'), b.normalize('NFC')) || compare(a, b);
}

export function isVisibleImagePath(path: string) {
  return /\.(jpe?g|png|webp)$/i.test(path) &&
    !path.split('/').some((part) => part.startsWith('.') || part === '__MACOSX');
}
