import sys
from math import gcd


def main():
    data = sys.stdin.buffer.read().split()
    n = int(data[0])
    # Keep every common moment so far as t + k*M (t = earliest, M = lcm so far)
    # and merge one beacon at a time (Chinese remainder theorem for moduli
    # that need not be coprime).
    t, m = 0, 1
    for i in range(n):
        p = int(data[1 + 2 * i])
        r = int(data[2 + 2 * i])
        g = gcd(m, p)
        diff = r - t
        if diff % g != 0:
            print(-1)
            return
        step = p // g
        k = 0
        if step > 1:
            k = (diff // g) * pow(m // g, -1, step) % step
        t += k * m
        m = m // g * p
        t %= m
    print(t)


main()
