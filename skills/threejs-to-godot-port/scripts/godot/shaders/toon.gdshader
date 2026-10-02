shader_type spatial;
// Toon material that reproduces three.js MeshToonMaterial (r185) for a gradientMap.
// three.js samples the gradient at x = dot(N, L) * 0.5 + 0.5 with nearest filtering and uses the r channel as the
// direct-light factor. The direct term is irradiance * albedo / PI; Godot's LIGHT_COLOR already carries a factor PI,
// so dividing by PI here gives color * energy * step, and the Godot light energy is the three.js intensity / PI.
// The hemisphere light is added in fragment() from the sky and ground colors (three.js HemisphereLight).
// Colors: albedo_color and the vertex color are used as linear reflectance after the usual sRGB conversion.
render_mode cull_disabled, specular_disabled;

uniform vec4 albedo_color : source_color = vec4(1.0);
uniform bool use_vertex_color = false;
uniform sampler2D gradient_map : filter_nearest, repeat_disable;
uniform vec3 sky_color : source_color = vec3(1.0);
uniform vec3 ground_color : source_color = vec3(0.5);
uniform float hemisphere_energy = 0.0;   // three.js hemisphere intensity / PI

void fragment() {
	vec3 base = albedo_color.rgb;
	if (use_vertex_color) {
		base *= COLOR.rgb;
	}
	ALBEDO = base;
	ROUGHNESS = 1.0;
	SPECULAR = 0.0;
	vec3 n_world = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
	vec3 hemi = mix(ground_color, sky_color, 0.5 * n_world.y + 0.5);
	EMISSION = base * hemi * hemisphere_energy;
}

void light() {
	float d = dot(NORMAL, LIGHT);
	float step_value = texture(gradient_map, vec2(d * 0.5 + 0.5, 0.5)).r;
	DIFFUSE_LIGHT += LIGHT_COLOR * ATTENUATION * step_value / PI;
}
