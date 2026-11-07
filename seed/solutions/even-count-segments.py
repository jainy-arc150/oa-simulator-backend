import random
import sys

HASH_SEED = 20261107
HASH_BITS = 64


def main():
    data = sys.stdin.buffer.read().split()
    n = int(data[0])
    a = data[1:1 + n]
    # Give every distinct value a random 64-bit code. The XOR of the codes of a
    # prefix describes which values occurred an odd number of times in it.
    # A segment is even exactly when the prefixes before and after it have the
    # same XOR, so we count equal prefix XORs with a hash map.
    rng = random.Random(HASH_SEED)
    code = {}
    cur = 0
    seen = {0: 1}
    ans = 0
    for tok in a:
        x = int(tok)
        c = code.get(x)
        if c is None:
            c = rng.getrandbits(HASH_BITS)
            code[x] = c
        cur ^= c
        k = seen.get(cur, 0)
        ans += k
        seen[cur] = k + 1
    print(ans)


main()
