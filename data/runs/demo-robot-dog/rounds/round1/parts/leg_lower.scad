lower_len=40;
leg_w=16;
leg_t=7;
pivot_d=5;
foot_d=22;
foot_h=6;
$fn=32;
union(){
 difference(){
  hull(){
   translate([0,lower_len/2,0]) cylinder(d=leg_w, h=leg_t, center=true);
   translate([0,-lower_len/2,0]) cylinder(d=leg_w, h=leg_t, center=true);
  }
  translate([0,lower_len/2,0]) cylinder(d=pivot_d, h=leg_t+2, center=true);
 }
 translate([0,-lower_len/2,0]) cylinder(d=foot_d, h=foot_h, center=true);
}