import random
import sys

N_MAX = 100000
V_MAX = 1000000000
SMALL_N_MAX = 30
BASE_MAX = 6
MULT_MAX = 50
MAX_BASES = 200
MAX_BASE_VALUE = 50
MAX_MULT = 20000


def scaled(rng, base, mult_max):
    p, q = base
    m = rng.randint(1, mult_max)
    s = rng.choice([1, -1])  # flipping both signs keeps the value
    return s * p * m, s * q * m


def random_base(rng, top):
    q = 0
    while q == 0:
        q = rng.randint(-top, top)
    return rng.randint(-top, top), q


def main():
    seed = int(sys.argv[1])
    use_max = len(sys.argv) > 2 and sys.argv[2] == "max"
    rng = random.Random(seed)

    if use_max:
        n = N_MAX
        bases = [random_base(rng, MAX_BASE_VALUE) for _ in range(MAX_BASES)]
        f = [scaled(rng, rng.choice(bases), MAX_MULT) for _ in range(n)]
    else:
        n = rng.randint(1, SMALL_N_MAX)
        if rng.randint(0, 2) < 2:
            # Few base values, scaled and sign-flipped: many equal pairs.
            bases = [random_base(rng, BASE_MAX) for _ in range(rng.randint(1, 4))]
            f = [scaled(rng, rng.choice(bases), MULT_MAX) for _ in range(n)]
        else:
            f = [random_base(rng, V_MAX) for _ in range(n)]

    print(n)
    for p, q in f:
        print(p, q)


main()
