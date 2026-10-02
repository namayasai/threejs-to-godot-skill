# Physics and determinism: re-verify, do not port

A physics engine is not a rendering feature. Moving a game from three.js to Godot changes what produces motion, so equal pictures say nothing about equal behavior. Treat physics, timing and determinism as a new system to measure.

Evidence marks: [case] = measured in the case study (`docs/case-study/physics-numbers.md`; Godot 4.7.stable, Jolt and Godot Physics, Apple M1, headless, other apps running); [unverified] = not measured; check before relying on it.

## 1. Decide first: do you need the engine to produce the motion?

Answer these in order.

1. **Do you need any of these: the same input always gives the same result, a prediction line that equals the real path, replays, rollback, or server-side validation?**
   If yes, keep your own fixed-step calculation. Port that code function by function (see `SKILL.md`, carrying path B), test it against recorded traces, and use Godot only to draw. Reasons from the case:
   - A world cloned to predict the path, with only position, orientation, velocity and angular velocity copied, ended up to 13 mm away from the real path (Jolt, one landing case), and 7 mm in Godot Physics. Hidden state (sleep, contact history) cannot be copied. Cloning a whole physics space and stepping it by hand was not possible in 4.7: `PhysicsServer3D` has no call to step a space [case].
   - Jolt, 50 runs of the same input in one process, each in a freshly built world: one case changed its path from run 37 on. Across separate processes, all 12 cases were identical. The cause was not investigated [case].
2. **Does the game's feel depend on rules that no engine setting produces?** (Examples from the case: an upright body that falls over on landing, deceleration that depends on the rolling direction, a speed loss at landing.) If yes, those rules stay in your code. A match using only engine settings was not reached in the case: after fitting three settings to the same eight cases, only three of eight were within the tolerance [case]. Using the engine for collision detection only and keeping the motion rules in code was not tried [unverified].
3. **Otherwise** the built-in physics can drive the motion, after you measure it (section 2).

The tolerance (the case used 0.02 m) is a project decision. Do not choose it for the human.

## 2. Measure before choosing

Run the same scripted inputs through your reference (the old behavior) and through each engine you can switch to. For each input record:

| Measure | How |
| --- | --- |
| End position difference to the reference | Last sample after the body rests, distance to the reference's end position; count the cases within the tolerance |
| Time to rest | First step where speed stays under a threshold for a set time; difference to the reference. Record the engine's own sleep time separately |
| Tunneling | Steps in which the body's center is inside a collider; the deepest overlap |
| Rest jitter | After resting for 10 s: largest drift, number of times speed rose again |
| Repeats | N runs, fresh world each time; N runs placing the body again in the same world; the same set in a second process. Hash the full path (position and velocity per step) |
| Prediction | A second world given the state at launch, and the state mid-flight; largest path difference to the real run |
| Cost | Time per physics step with the scene's colliders (state the machine, build, load, and whether the timing includes your scripts) |
| First contact | Position and time of the first collision against the reference |

Report the machine, the Godot build, headless or not, the fixed step rate, and the load on the machine. Do not report numbers you did not measure (frame rate was not measured in the case).

If you tune engine parameters (friction, damping, bounce), report the untuned numbers next to the tuned ones, the parameter grid you tried, and how you chose. A fit to the same cases you report is not a generalization. In the case: untuned Jolt 2 of 8, untuned Godot Physics 0 of 8; tuned 3 of 8 and 3 of 8 [case].

## 3. Setting up a fair run

- Fixed step: `physics/common/physics_ticks_per_second` set to the reference's step rate. Disable `physics_jitter_fix` and physics interpolation when you compare against a reference [case settings; each setting's individual effect was not measured].
- Switching engines: no command-line flag. Write `override.cfg` before each run (`[physics]` section, `3d/physics_engine="Jolt Physics"` or `"GodotPhysics3D"`) and delete it afterwards. Keep it out of version control. The log does not name the engine, so record a fingerprint: let a body rest on a plane and record its sink depth and time to sleep. The case's fingerprint: Jolt sinks 0 to 1 micrometer and sleeps at 0.250 s; Godot Physics sinks 1.0 to 13.2 mm depending on shape and sleeps at 0.267 s [case].
- Speed: `--fixed-fps 120` makes physics frames run as fast as possible in headless tests [case].
- Start-up: step the physics a few frames before the first impulse. The first step ignores impulses in both engines [case].
- A body frozen until the impulse step can be unfrozen and pushed in the same step; the push takes effect [case].

Example 03 (`examples/03-physics-recheck/`) runs this protocol on a tiny scene [measured, Godot 4.7.stable, Apple M1, headless]: a box sliding on a floor, a cylinder rolling on its side. In both engines, 20 fresh worlds gave one path hash and a second process gave the same hash. A box sliding at 2 m/s with friction 0.5 stopped 0.0000 m from the constant-deceleration reference in Jolt and 0.0019 m from it in Godot Physics. A resting box sank 0.000 mm in Jolt and 0.184 mm in Godot Physics, so the engines can be told apart and the engine switch can be proven. The tiny scene did not reproduce the case's Jolt path change (it needed 50 repeats of a larger scene), so a clean result here is not evidence for your scene.

## 4. Engine facts from the case (Godot 4.7.stable)

| Topic | Jolt | Godot Physics | Evidence |
| --- | --- | --- | --- |
| `RigidBody3D.continuous_cd` | boolean, not a three-way setting | same property | [case] probe P1 |
| Sleep defaults (speed, time) | 0.03 m/s, 0.5 s (Jolt settings) | 0.1 m/s linear, 0.1396 angular, 0.5 s | [case] probe P1 |
| Friction of a pair | the smaller of the two | the smaller of the two | [case] probe P2 |
| Bounce of a pair | the sum, clamped to 0..1 | similar for walls; a ground drop bounced far less than the sum | [case] probe P2 |
| Rolling cylinder | does not stop without angular damping | same | [case] probe P4 |
| Angular velocity cap | 47.12 rad/s by default; raise it for fast spin | not capped in the same way [unverified] | [case] probe P1 |
| Thin or flat body at rest | sink 0 to 1 micrometer, sleeps | sink up to 13.2 mm, did not sleep in 10 s, moved up to 0.097 m after "stopped" | [case] |
| Step cost, one body, small scene | 81.6 microseconds per loop | 51.7 microseconds per loop | [case] (includes a minimal script; headless; fixed step) |

## 5. What the engines could not do

Settings alone did not give: falling over on landing, a speed loss at landing, deceleration that depends on the rolling direction, direction rules at walls. An upright body kept upright; a lying body needed damping to stop; the damping value matched the reference at one speed and drifted at others (distance ratio engine to reference: Jolt 1.89, 0.98, 0.61 at three launch speeds; Godot Physics 1.57, 0.82, 0.55) [case]. If the game relies on such rules, expect to write them.

## 6. Recording a reference from a JavaScript physics engine

If the original uses a JavaScript engine (for example cannon-es or Rapier), its behavior is the reference, and it has to be recorded before anything can be compared. No tool in this skill does it, and module mode cannot import such a package (only `three` is resolved). Do it in a separate Node script or in page mode. What the case showed:

- Step the original's physics with a fixed step of the length you will use in Godot, a fixed seed and no wall clock. Do not drive it from `requestAnimationFrame`.
- Write one record per step (position, orientation, velocity, angular velocity), plus the first contact (position and time) and the rest step, to a JSON file. Hash the whole path. Use that file as the reference in the measures of section 2.
- Build a fresh world for every run. cannon-es gave two different paths when the body was placed again in a world that had been used (largest difference 5.8e-5 m); Rapier gave one [case].
- Record in the environment you will trust. For cannon-es, 42 of 997 recorded paths differed between Node and Chromium; Rapier and the project's own code matched in all of them. JavaScript math functions can differ between engines [case].
- If the reference is your own deterministic code ported to another language, compare per step. In the case, 97.0 percent of the values were bit-identical and the largest difference was 7.1e-15 m, from the last digit of `cos` and `sin`; the project's limit was 1e-12 [case].

## 7. Also in JavaScript

The same questions were asked of JavaScript engines in the case. Within the tolerance of the eight cases, Rapier with a free cylinder: 3 of 8; cannon-es: 0 of 8; with the game's own rules added outside the engine: Rapier 6 of 8, cannon-es 5 of 8. Rapier gave identical results in fresh worlds; cannon-es split into two paths when the same world was reused [case, `docs/case-study/physics-numbers.md`].

## 8. Not measured

Other machines and operating systems; other engines (Bullet, Rapier in Godot); frame rate; swept tunneling at high speed; kinematic and moving colliders; many bodies. If your game needs one of these, measure it.
