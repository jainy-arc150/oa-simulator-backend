import random
import sys
from math import gcd

N_MAX = 1000
LCM_MAX = 10 ** 18
SMALL_N_MAX = 6
SMALL_P_MAX = 12
# The max input uses divisors of L = 2^11 * 3^4 * 5^3 * 7^2 * 11 * ... * 31.
PRIME_POWERS = [(2, 11), (3, 4), (5, 3), (7, 2), (11, 1), (13, 1), (17, 1),
                (19, 1), (23, 1), (29, 1), (31, 1)]


def lcm_all(ps):
    m = 1
    for p in ps:
        m = m // gcd(m, p) * p
    return m


def main():
    seed = int(sys.argv[1])
    use_max = len(sys.argv) > 2 and sys.argv[2] == "max"
    rng = random.Random(seed)

    if use_max:
        n = N_MAX
        ps = []
        for _ in range(n):
            p = 1
            for prime, e in PRIME_POWERS:
                p *= prime ** rng.randint(0, e)
            ps.append(p)
        big = lcm_all(ps)
        assert big <= LCM_MAX
        target = rng.randrange(big)
        rs = [target % p for p in ps]
    else:
        n = rng.randint(1, SMALL_N_MAX)
        ps = [rng.randint(1, SMALL_P_MAX) for _ in range(n)]
        if rng.randint(0, 1) == 0:
            # A common moment exists.
            target = rng.randrange(lcm_all(ps))
            rs = [target % p for p in ps]
        else:
            # Random residues: often no common moment.
            rs = [rng.randrange(p) for p in ps]

    print(n)
    for p, r in zip(ps, rs):
        print(p, r)


main()
