// Freezer Door Latch Clip - PETG
// Units mm, prints flat
base_L = 32;
base_W = 20;
base_T = 4;
wall_T = 4;
hook_W = 14;
hook_H = 10;
lip_over = 5;
lip_T = 3;
hole_D = 4.2;
hole_spacing = 20;
rib_T = 2.5;
rib_L = 8;
rib_H = 6;
$fn = 48;
// derived
top_Z = base_T + hook_H;
x_wall = base_L - wall_T;
y0 = (base_W - hook_W) / 2;
x_tip = x_wall - lip_over;
z_lip_bot = top_Z - lip_T;
difference() {
  union() {
    cube([base_L, base_W, base_T]);
    translate([x_wall, y0, 0]) cube([wall_T, hook_W, top_Z]);
    translate([x_tip, y0, z_lip_bot]) cube([wall_T + lip_over, hook_W, lip_T]);
    translate([x_wall - rib_L, y0 - rib_T, base_T]) cube([rib_L, rib_T, rib_H]);
    translate([x_wall - rib_L, y0 + hook_W, base_T]) cube([rib_L, rib_T, rib_H]);
    translate([x_wall - rib_L, y0, base_T]) cube([rib_L, hook_W, 2]);
  }
  translate([base_L/2 - hole_spacing/2, base_W/2, -1]) cylinder(d=hole_D, h=base_T+2);
  translate([base_L/2 + hole_spacing/2, base_W/2, -1]) cylinder(d=hole_D, h=base_T+2);
}
