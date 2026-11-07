// Freezer door latch clip - PETG, mm
$fn=64;
// Key dimensions
 Overall_length=45;
Overall_width=20;
Base_thickness=4;
Hook_height=8;
Mounting_hole_diameter=4;
Mounting_hole_spacing=30;
Hook_depth=10;
Lip_overhang=4;
Lip_thickness=2.5;
Fillet_r=3;
Lead_chamfer=1.2;
// Derived
Hook_x0 = Overall_length/2 - Hook_depth;
Lip_z0 = Base_thickness + Hook_height - Lip_thickness;
difference(){
  union(){
    // base plate
    translate([-Overall_length/2, -Overall_width/2, 0])
      cube([Overall_length, Overall_width, Base_thickness]);
    // hook upright - thickened to prevent fatigue snap
    translate([Hook_x0, -Overall_width/2, Base_thickness])
      cube([Hook_depth, Overall_width, Hook_height]);
    // catch lip overhanging toward center (-X)
    translate([Hook_x0 - Lip_overhang, -Overall_width/2, Lip_z0])
      cube([Lip_overhang + Hook_depth, Overall_width, Lip_thickness]);
    // fillet / reinforcement at base-hook junction
    rotate([90,0,0])
      translate([Hook_x0, Base_thickness, -Overall_width/2])
        cylinder(r=Fillet_r, h=Overall_width);
  }
  // two mounting through holes
  for(sx=[-1,1])
    translate([sx*Mounting_hole_spacing/2, 0, -0.5])
      cylinder(d=Mounting_hole_diameter, h=Base_thickness+Lip_thickness+1);
  // lead-in bevel on lip nose for snap-fit
  translate([Hook_x0 - Lip_overhang -0.5, -Overall_width/2 -0.5, Lip_z0 -0.5])
    rotate([0,45,0])
      cube([Lead_chamfer*1.6, Overall_width+1, Lead_chamfer*1.6]);
}