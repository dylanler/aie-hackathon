upper_len=35;
leg_w=20;
leg_t=8;
horn_d=7;
knee_d=13;
mtg_d=3;
$fn=32;
difference(){
 hull(){
  translate([-upper_len/2,0,0]) cylinder(d=leg_w, h=leg_t, center=true);
  translate([upper_len/2,0,0]) cylinder(d=leg_w, h=leg_t, center=true);
 }
 union(){
  translate([-upper_len/2,0,0]) cylinder(d=horn_d, h=leg_t+2, center=true);
  translate([upper_len/2,0,0]) cylinder(d=knee_d, h=leg_t+2, center=true);
  translate([-upper_len/2,0,0]) translate([0,7,0]) cylinder(d=mtg_d, h=leg_t+2, center=true);
  translate([-upper_len/2,0,0]) translate([0,-7,0]) cylinder(d=mtg_d, h=leg_t+2, center=true);
 }
}