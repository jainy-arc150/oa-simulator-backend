import random
import sys

N_MAX = 200000
H_MAX = 1000000000
SMALL_N_MAX = 12
SMALL_H = 10
MAX_H_RANGE = 1000000


def main():
    seed = int(sys.argv[1])
    use_max = len(sys.argv) > 2 and sys.argv[2] == "max"
    rng = random.Random(seed)

    if use_max:
        n = N_MAX
        k = rng.randint(n // 4, 3 * n // 4)
        h = [rng.randint(0, MAX_H_RANGE) for _ in range(n)]
    else:
        n = rng.randint(1, SMALL_N_MAX)
        k = rng.randint(1, n)
        profile = rng.randint(0, 2)
        if profile == 0:
            h = [rng.randint(0, SMALL_H) for _ in range(n)]
        elif profile == 1:
            # Clusters: a tight pair next to a looser but larger group.
            h = [rng.choice([0, 1, 5, 6, 6, 6, 20, 21]) + rng.randint(0, 1) for _ in range(n)]
        else:
            h = [rng.randint(0, H_MAX) for _ in range(n)]

    print(n, k)
    print(" ".join(map(str, h)))


main()
