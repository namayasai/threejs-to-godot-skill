shader_type spatial;
// Inverted-hull outline: a second copy of the mesh, drawn back faces only, pushed outward in screen space by a fixed
// number of pixels. Equivalent of a three.js BackSide MeshBasicMaterial whose vertex shader was patched with
// onBeforeCompile. Needs smooth (averaged) normals on the hull mesh, or the hull tears at hard edges.
// Godot's clip space has y pointing down, so the screen-space direction needs its y flipped.
render_mode unshaded, cull_front, depth_draw_opaque;

uniform vec4 outline_color : source_color = vec4(0.1, 0.1, 0.12, 1.0);
uniform float thickness_px_at_720 = 2.0;   // thickness at a 720 pixel high viewport; scales with the viewport height

void vertex() {
	vec4 clip = PROJECTION_MATRIX * MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	vec3 nv = normalize(MODELVIEW_NORMAL_MATRIX * NORMAL);
	vec2 dir = vec2(nv.x, -nv.y);
	float len = length(dir);
	if (len > 0.0001) {
		float px = thickness_px_at_720 * VIEWPORT_SIZE.y / 720.0;
		clip.xy += (dir / len) * (2.0 * px / VIEWPORT_SIZE) * clip.w;
	}
	POSITION = clip;
}

void fragment() {
	ALBEDO = outline_color.rgb;
}
