# Physics numbers from the case study

These tables come from the case study's measurements. The conditions are named by what happens, not by the game's internal ids, and absolute positions and game constants are left out.

**Read this first.**

- The "reference" is the project's own deterministic fixed-step calculation (the behavior being ported). A result "within tolerance" is within 0.02 m of the reference's end position. The tolerance was the project's choice.
- Each engine was run twice: **untuned** (values derived from the reference's rules: friction, bounce, damping, sleep, mass, continuous collision detection on) and **tuned** (three body settings fitted by a grid search: angular damping, friction scale and wall bounce; 54 combinations per engine; the sum of eight end-position differences was minimized). **Tuned numbers are a fit to the same eight cases that are reported. They are not a generalization.** The untuned numbers are the fair ones.
- Machine and build: Apple M1 (8 cores), 16 GB, macOS 27.0, Godot 4.7.stable.official, headless, `--fixed-fps 120`, 120 Hz physics, other applications running (load average 2.3 to 2.6 at the start). Frame rate was not measured.
- The web-side columns come from a separate set of measurements with Rapier 0.21.0 and cannon-es 0.20.0 in Chromium 153 and Node 22.14.0.

## 1. The eight cases and the end-position difference (meters)

Within tolerance (0.02 m or less) is marked with an asterisk.

| Case | Jolt untuned | Jolt tuned | Godot Physics untuned | Godot Physics tuned | Rapier, free cylinder (web) |
| --- | --- | --- | --- | --- | --- |
| Upright body, weak launch | 0.040 | 0.040 | 0.061 | 0.061 | 2.702 |
| Lying body rolls, launched along the ground | 0.318 | 0.001 * | 0.116 | 0.009 * | 25.769 |
| Crushed (flat) body slides | 0.000 * | 0.000 * | 0.132 | 0.120 | 0.009 * |
| Landing from a step | 0.280 | 0.095 | 0.193 | 0.119 | 8.697 |
| Upright body, high arc over a fence | 0.084 | 0.084 | 0.771 | 0.338 | 0.439 |
| Flat body, passes under a fence | 0.000 * | 0.000 * | 0.132 | 0.137 | 0.010 * |
| Weak launch into a wall | 0.146 | 0.076 | 0.102 | 0.009 * | 0.019 * |
| Weak launch into a car (as a wall) | 0.148 | 0.078 | 0.104 | 0.011 * | 0.116 |
| Cases within tolerance | 2 of 8 | 3 of 8 | 0 of 8 | 3 of 8 | 3 of 8 |

Other web-side results on the same eight cases (Rapier and cannon-es; the "rules added" runs add the game's own landing, deceleration, rest and wall rules outside the engine):

| Setup | Cases within tolerance |
| --- | --- |
| Rapier, free cylinder | 3 of 8 |
| cannon-es, free cylinder | 0 of 8 |
| Rapier, flat disc, rules added | 6 of 8 |
| cannon-es, flat disc, rules added | 5 of 8 |

First contact (landing or wall) against the reference: position difference 0.001 to 0.021 m and time difference 0.003 to 0.014 s in both Godot engines, untuned and tuned alike. The flight before the first contact is a plain parabola, so engines agree there.

The tuned values are not listed here because they are specific to one game. Jolt's best angular damping sat at the edge of the grid, so a wider grid might have changed it. (Fitting eight cases, widening the grid has little value.)

## 2. Time to rest (seconds, difference to the reference)

The "rest" definition: the body's bottom is within a small distance of the supporting surface and its horizontal speed stays under a threshold for a set time.

| Case | Jolt untuned | Jolt tuned | Godot Physics untuned | Godot Physics tuned |
| --- | --- | --- | --- | --- |
| Upright body, weak launch | -0.133 | -0.133 | +0.050 | +0.050 |
| Lying body rolls | +0.683 | +0.133 | +0.433 | +0.208 |
| Crushed body slides | 0.000 | 0.000 | +0.017 | +0.017 |
| Landing from a step | +0.642 | +0.267 | +0.525 | +0.342 |
| High arc over a fence | -0.217 | -0.217 | +0.383 | +0.358 |
| Passes under a fence | 0.000 | 0.000 | +0.017 | +0.017 |
| Weak launch into a wall | +0.567 | +0.267 | +0.433 | +0.217 |
| Weak launch into a car | +0.575 | +0.275 | +0.442 | +0.225 |

## 3. Tunneling, rest jitter and sleeping

Continuous collision detection was on in both engines. The launches moved at most 0.029 m per step, so the tunneling room was small. Swept high-speed tunneling was not measured.

| Item | Jolt | Godot Physics |
| --- | --- | --- |
| Body center inside a wall box (eight cases) | 0 steps; lowest overlap 0.0000 m | 0 steps; overlap up to 0.0199 m (fence), 0.0002 m (wall and car) |
| Largest drift in 10 s after "stopped" | 0 | up to 0.097 m untuned, 0.084 m tuned (the flat body kept moving after the rest judgment) |
| Times speed rose again after rest | 0 | 0 (largest speed after rest 0.037 m/s) |
| Engine put the body to sleep | all eight cases, 0 to 0.24 s before the rest judgment | six of eight; the flat body did not sleep in 10 s |
| Resting body fingerprint (3 s) | sink 0 to 1 micrometer, sleeps at 0.250 s (all three poses) | sink 1.0 mm lying, 2.8 mm upright, 13.2 mm flat (did not sleep), sleeps at 0.267 s |

## 4. Repeats of the same input

| Item | Jolt | Godot Physics |
| --- | --- | --- |
| 20 runs per case, fresh world each run (path hashed over every step) | one hash for all eight cases | one hash for all eight cases |
| 50 runs of two long cases | one case: one hash. The other: **two hashes** (runs 1 to 36 on one path, runs 37 to 50 on another, in one process) | one hash each |
| 20 to 50 runs, only the body placed again in the same world | one hash each | one hash each |
| Re-run in a separate process (12 conditions) | 12 of 12 the same | 12 of 12 the same |

The web side: Rapier (normal and deterministic builds) gave one hash in 50 fresh-world runs; cannon-es gave one hash in fresh worlds and **two** when the body was placed again in the same world (largest difference 5.8e-5 m).

## 5. Prediction: a second world given the state

The path of a second world, given (a) the same input before the launch, or (b) the body's position, orientation, velocity and angular velocity at 0.25 s into the flight, compared to the real run. Largest path difference in meters.

| Case | Jolt (a) | Jolt (b) | Godot Physics (a) | Godot Physics (b) |
| --- | --- | --- | --- | --- |
| Upright body, weak launch | 0 | 0 | 0 | 0 |
| Lying body rolls | 0.00098 | 0.00098 | 0 | 0 |
| Crushed body slides | 0 | 0 | 0 | 0.00100 |
| Landing from a step | 0.00007 | **0.01348** | 0 | 0 |
| High arc over a fence | 0.00006 | 0.00006 | 0 | 0 |
| Passes under a fence | 0 | 0 | 0 | **0.00718** |
| Wall and car cases | 0.00052 | 0.00052 | 0 | 0 |

- Identical paths (identical hash) in the (a) setup: Godot Physics only (11 of 11 conditions). Jolt differed by up to 1 mm in a second world.
- Hidden state (sleep, contact history) cannot be copied. There was no public call to step a whole physics space by hand in 4.7.
- On the web side, a Rapier snapshot reproduced the continuation exactly; cannon-es could not clone contact history.

## 6. Cost per step

One body, 2000 steps times three sets (median), one launch every 60 steps, headless, fixed step. The value is the whole loop time (physics step plus a minimal script), not the physics time alone.

| Scene | Jolt, with body | Godot Physics, with body | Static boxes only (Jolt / Godot Physics) |
| --- | --- | --- | --- |
| Smallest (a wall, a car, a ground) | 81.6 microseconds | 51.7 microseconds | 5.0 / 4.1 microseconds |
| A level's worth of static colliders (58 walls, 3 floors, a ground) | 81.4 microseconds | 51.8 microseconds | 4.9 / 4.3 microseconds |

A 120 Hz step has 8333 microseconds. The `Performance` counters for physics time were unusable in headless fixed-step mode (zeros and irregular values) and are not reported.

## 7. Rolling resistance: why damping fitted one speed only

A lying cylinder rolled at three launch speeds. Untuned angular damping was zero, then a value derived to match one speed. Distance rolled as a ratio to the reference's distance:

| Launch speed (low, middle, high) | Jolt, no damping | Jolt, damped for the middle speed | Godot Physics, damped for the middle speed |
| --- | --- | --- | --- |
| Ratio to the reference | did not stop in 12 s | 1.89, 0.98, 0.61 | 1.57, 0.82, 0.55 |

A body sliding along its axis matched the reference's deceleration in both engines (stop distances within about 2 percent at two speeds), because there friction alone decides it.
