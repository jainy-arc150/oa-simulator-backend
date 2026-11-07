import random
import sys

N_MAX = 10000
H_MAX = 1000000000
SMALL_N_MAX = 30
SMALL_H = 5
MAX_H_RANGE = 1000


def main():
    seed = int(sys.argv[1])
    use_max = len(sys.argv) > 2 and sys.argv[2] == "max"
    rng = random.Random(seed)

    if use_max:
        n = N_MAX
        h = [rng.randint(1, MAX_H_RANGE) for _ in range(n)]
    else:
        n = rng.randint(1, SMALL_N_MAX)
        profile = rng.randint(0, 2)
        if profile == 0:
            # Many equal heights.
            h = [rng.randint(1, SMALL_H) for _ in range(n)]
        elif profile == 1:
            # Heights with different digit counts (text order != numeric order).
            h = [rng.choice([9, 10, 99, 100, 1000, H_MAX]) for _ in range(n)]
        else:
            h = [rng.randint(1, H_MAX) for _ in range(n)]

    print(n)
    print(" ".join(map(str, h)))


main()
