// Freezer door latch clip - PETG
// mm units, bottom of base at z=0, centered in x/y
base_L = 38;
base_W = 22;
base_T = 3;
hole_d = 4.2;
hole_spacing = 25;
post_t = 6; // thickened vs original to stop fatigue fracture
post_h = 12;
hook_tip_t = 4;
hook_overhang = 8; // engagement length past inner face of post
fillet_r = 3; // enlarged root fillet for cold toughness
gusset_len = 10;
gusset_h = 8;
gusset_t = 3;
$fn = 48;

module gusset_plate() {
    // triangle in XZ, extruded in Y
    linear_extrude(height = gusset_t)
        polygon(points = [[0,0],[gusset_len,0],[0,gusset_h]]);
}

difference() {
    union() {
        // base plate
        translate([-base_L/2, -base_W/2, 0])
            cube([base_L, base_W, base_T]);
        // vertical post at +X end, full width
        translate([base_L/2 - post_t, -base_W/2, base_T])
            cube([post_t, base_W, post_h]);
        // top hook arm extending back (-X) over base
        translate([base_L/2 - post_t - hook_overhang, -base_W/2, base_T + post_h - hook_tip_t])
            cube([post_t + hook_overhang, base_W, hook_tip_t]);
        // root fillet bar at inner base-post junction (along Y)
        translate([base_L/2 - post_t, -base_W/2, base_T])
            rotate([90, 0, 0])
                cylinder(r = fillet_r, h = base_W);
        // top fillet bar at post-hook junction
        translate([base_L/2 - post_t, -base_W/2, base_T + post_h - hook_tip_t - fillet_r])
            rotate([90, 0, 0])
                cylinder(r = fillet_r, h = base_W);
        // side gussets for stiffness (left/right)
        // inner face of post is at inner_x
        translate([base_L/2 - post_t - gusset_len, base_W/2 - gusset_t, base_T])
            gusset_plate();
        translate([base_L/2 - post_t - gusset_len, -base_W/2, base_T])
            gusset_plate();
    }
    // two M4 clearance holes through base
    for (sx = [-1, 1])
        translate([sx*hole_spacing/2, 0, -0.5])
            cylinder(d = hole_d, h = base_T + 1.5);
    // lead-in chamfer under hook tip for easy clip-on (30deg ramp)
    translate([base_L/2 - post_t - hook_overhang - 0.5, -base_W/2 - 0.5, base_T + post_h - hook_tip_t - 3.2])
        rotate([0, 30, 0])
            cube([6, base_W+1, 4]);
}