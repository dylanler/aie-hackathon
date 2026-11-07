// Freezer door latch clip - enclosed tunnel, PETG, mm
$fn=64;
Overall_length=40;
Overall_width=20;
Base_thickness=4;
Channel_width=7;
Channel_height=7;
Tunnel_wall=3.5;
Roof_thickness=3.5;
Mounting_hole_diameter=4.5;
Mounting_hole_spacing=28;
// Tunnel layout centered near x=2
Ch_x0=-1.5;
Ch_x1=5.5;
Ch_z0=4;
Ch_z1=11;
Blk_x0=-5;
Blk_x1=9;
Blk_z1=14.5;
difference(){
  union(){
    // base plate full footprint
    translate([-Overall_length/2, -Overall_width/2, 0])
      cube([Overall_length, Overall_width, Base_thickness]);
    // tunnel outer block (floor is base, walls + roof)
    translate([Blk_x0, -Overall_width/2, Base_thickness])
      cube([Blk_x1-Blk_x0, Overall_width, Blk_z1-Base_thickness]);
  }
  // rectangular striker channel through full width (Y axis)
  translate([Ch_x0, -Overall_width/2-1, Ch_z0-0.5])
    cube([Ch_x1-Ch_x0, Overall_width+2, (Ch_z1-Ch_z0)+0.5]);
  // two vertical M4 clearance holes, outside tunnel, reachable from above
  for(sx=[-1,1])
    translate([sx*Mounting_hole_spacing/2, 0, -0.5])
      cylinder(d=Mounting_hole_diameter, h=Base_thickness+2);
}