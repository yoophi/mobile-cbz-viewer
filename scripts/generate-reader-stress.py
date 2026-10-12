"""Synthetic native reader load: distinct high-resolution images and a long strip."""
import argparse
import pathlib
import random
import struct
import zipfile
import zlib


def png(width, height, seed, noise=False):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    rng = random.Random(seed)
    compressor = zlib.compressobj(1)
    parts = []
    # Grayscale image: random pages decode to large bitmaps without retaining giant Python buffers.
    row = rng.randbytes(width)
    for y in range(height):
        if noise:
            row = rng.randbytes(width)
        elif y % 64 == 0:
            row = rng.randbytes(width)
        parts.append(compressor.compress(b'\0' + row))
    parts.append(compressor.flush())
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 0, 0, 0, 0))
            + chunk(b'IDAT', b''.join(parts)) + chunk(b'IEND', b''))


parser = argparse.ArgumentParser()
parser.add_argument('directory', nargs='?', default='/tmp')
parser.add_argument('--pages', type=int, default=40)
parser.add_argument('--books', type=int, default=2)
parser.add_argument('--prefix', default='reader-stress')
args = parser.parse_args()
if not 2 <= args.pages <= 2000 or not 1 <= args.books <= 10:
    parser.error('pages must be 2..2000 and books 1..10')
root = pathlib.Path(args.directory)
for book in range(args.books):
    destination = root / f'{args.prefix}-{book + 1}.cbz'
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_STORED) as archive:
        for page in range(args.pages):
            width, height = (512, 30000) if page == args.pages - 1 else (2048, 3072)
            archive.writestr(f'{page + 1}.png', png(width, height, book * 100 + page, noise=page < 4))
    print(destination, destination.stat().st_size)
