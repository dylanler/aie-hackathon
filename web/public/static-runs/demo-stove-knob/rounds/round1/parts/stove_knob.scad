// Stove Knob for 6mm D-shaft - ASA for 120C heat
outer_d = 42;
overall_h = 28;
skirt_h = 3;
skirt_d = 42;
body_top_d = 35;
body_h = overall_h - skirt_h;
bore_d = 6.0;
bore_r = bore_d/2 + 0.05;
flat_y = 1.55;
bore_depth = 20;
hub_d = 16;
hub_h = 22;
rib_n = 24;
rib_w = 3.0;
rib_h_depth = 1.6;
$fn = 96;

difference(){
 union(){
  cylinder(d=skirt_d, h=skirt_h);
  translate([0,0,skirt_h]) cylinder(d1=skirt_d, d2=body_top_d, h=body_h);
  // reinforced center hub with fillet to base
  translate([0,0,skirt_h]) cylinder(d1=hub_d+4, d2=hub_d, h=4);
  translate([0,0,skirt_h]) cylinder(d=hub_d, h=hub_h);
  // top cap rounding
  translate([0,0,overall_h-1]) cylinder(d1=body_top_d, d2=body_top_d-2, h=1);
  // grip ribs around tapered side
  for(i=[0:rib_n-1]) rotate([0,0,i*360/rib_n]) translate([(skirt_d+body_top_d)/4, 0, skirt_h+body_h/2]) cube([rib_h_depth, rib_w, body_h*0.85], center=true);
  // indicator boss on skirt edge
  rotate([0,0,0]) translate([skirt_d/2-2, 0, skirt_h/2]) cube([4,3,skirt_h], center=true);
 }
 // D-bore from back face (z=0) upward
 translate([0,0,-1]) intersection(){
  cylinder(r=bore_r, h=bore_depth+1);
  translate([-10,-10,0]) cube([20, 10+flat_y, bore_depth+1]);
 }
 // lead-in chamfer at mouth
 translate([0,0,-0.5]) cylinder(d1=9, d2=6.5, h=2.5);
 // indicator groove on top face
 translate([8,0,overall_h-1.2]) cube([16,2.2,2.5], center=false);
 // underside weight relief - annular recess leaving hub + outer wall
 translate([0,0,-1]) difference(){
  cylinder(d=36, h=5);
  cylinder(d=hub_d+4, h=7);
 }
}