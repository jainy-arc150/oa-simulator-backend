import random
import sys

N_MAX = 200000
SMALL_N_MAX = 30
PATTERN_MAX = 7
MAX_MUTATIONS = 20
POOLS = ["ab", "abc", "abcdefghijklmnopqrstuvwxyz"]


def periodic(rng, n, pool, mutations):
    pattern = "".join(rng.choice(pool) for _ in range(rng.randint(1, PATTERN_MAX)))
    s = list((pattern * (n // len(pattern) + 1))[:n])
    for _ in range(mutations):
        s[rng.randrange(n)] = rng.choice(pool)
    return "".join(s)


def main():
    seed = int(sys.argv[1])
    use_max = len(sys.argv) > 2 and sys.argv[2] == "max"
    rng = random.Random(seed)

    if use_max:
        s = periodic(rng, N_MAX, "ab", MAX_MUTATIONS)
    else:
        n = rng.randint(1, SMALL_N_MAX)
        pool = rng.choice(POOLS)
        profile = rng.randint(0, 2)
        if profile == 0:
            # A repeated pattern with a few changed letters: long borders.
            s = periodic(rng, n, pool, rng.randint(0, 2))
        elif profile == 1:
            s = "".join(rng.choice(pool) for _ in range(n))
        else:
            s = rng.choice(pool) * n
    print(s)


main()
