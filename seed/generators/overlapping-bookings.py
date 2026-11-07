import random
import sys

N_MAX = 100000
T_MAX = 1000000000
SMALL_N_MAX = 30
SMALL_T = 10
MAX_T_RANGE = 1000000
MAX_LENGTH = 1000


def main():
    seed = int(sys.argv[1])
    use_max = len(sys.argv) > 2 and sys.argv[2] == "max"
    rng = random.Random(seed)

    if use_max:
        n = N_MAX
        b = []
        for _ in range(n):
            s = rng.randint(0, MAX_T_RANGE - MAX_LENGTH)
            b.append((s, s + rng.randint(0, MAX_LENGTH)))
    else:
        n = rng.randint(1, SMALL_N_MAX)
        # Small coordinates make shared end points (touching bookings) common.
        top = SMALL_T if rng.randint(0, 1) == 0 else T_MAX
        b = []
        for _ in range(n):
            x, y = rng.randint(0, top), rng.randint(0, top)
            b.append((min(x, y), max(x, y)))

    print(n)
    for s, e in b:
        print(s, e)


main()
