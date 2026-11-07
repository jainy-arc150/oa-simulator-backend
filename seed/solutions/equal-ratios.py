import sys
from math import gcd


def main():
    data = sys.stdin.buffer.read().split()
    n = int(data[0])
    # Reduce every fraction to one canonical form: divide by the gcd and make
    # the denominator positive. Equal fractions then have equal forms.
    seen = {}
    ans = 0
    for i in range(n):
        p = int(data[1 + 2 * i])
        q = int(data[2 + 2 * i])
        g = gcd(p, q)
        p //= g
        q //= g
        if q < 0:
            p, q = -p, -q
        key = (p, q)
        c = seen.get(key, 0)
        ans += c
        seen[key] = c + 1
    print(ans)


main()
