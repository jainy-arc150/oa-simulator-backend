import random
import sys

N_MAX = 200000
D_MAX = 2000000000
A_MAX = 1000000000
SMALL_N_MAX = 30
SMALL_VALUE = 5
WALK_START = 100
WALK_STEP = 6
MAX_WALK_STEP = 10


def main():
    seed = int(sys.argv[1])
    use_max = len(sys.argv) > 2 and sys.argv[2] == "max"
    rng = random.Random(seed)

    if use_max:
        n = N_MAX
        d = rng.randint(0, MAX_WALK_STEP)
        x = rng.randint(-A_MAX // 2, A_MAX // 2)
        a = []
        for _ in range(n):
            a.append(x)
            x += rng.randint(-MAX_WALK_STEP, MAX_WALK_STEP)
    else:
        n = rng.randint(1, SMALL_N_MAX)
        profile = rng.randint(0, 2)
        if profile == 0:
            # Small values: many equal neighbours and many ties.
            d = rng.randint(0, SMALL_VALUE - 1)
            a = [rng.randint(-SMALL_VALUE, SMALL_VALUE) for _ in range(n)]
        elif profile == 1:
            # Random walk: long calm stretches broken by occasional jumps.
            d = rng.randint(0, WALK_STEP)
            x = rng.randint(-WALK_START, WALK_START)
            a = []
            for _ in range(n):
                a.append(x)
                x += rng.randint(-WALK_STEP, WALK_STEP)
        else:
            # Full range values and tolerance.
            d = rng.randint(0, D_MAX)
            a = [rng.randint(-A_MAX, A_MAX) for _ in range(n)]

    print(n, d)
    print(" ".join(map(str, a)))


main()
