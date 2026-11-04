(()=>{
  'use strict';
  const canvas=document.querySelector('#flow-field');
  if(!canvas||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const ctx=canvas.getContext('2d',{alpha:false});
  let width=0,height=0,dpr=1,frame=0,particles=[];
  const count=900;

  function reset(p,randomAge=true){
    p.x=Math.random()*width;
    p.y=Math.random()*height;
    p.px=p.x;p.py=p.y;
    p.age=randomAge?Math.random()*260:0;
    p.life=180+Math.random()*220;
    p.tint=Math.random()>.68?'157,232,210':'109,232,255';
  }

  function resize(){
    dpr=Math.min(devicePixelRatio||1,2);
    width=innerWidth;height=innerHeight;
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    particles=Array.from({length:Math.min(count,Math.round(width*height/1100))},()=>{const p={};reset(p);return p});
    ctx.fillStyle='#04070b';ctx.fillRect(0,0,width,height);
  }

  function velocity(x,y,t){
    const cx=width*.64+Math.sin(t*.00013)*width*.035;
    const cy=height*.49+Math.cos(t*.00017)*height*.03;
    const dx=x-cx,dy=y-cy;
    const r2=dx*dx+dy*dy+900;
    const swirl=Math.min(3.2,72000/r2);
    const wave=Math.sin(x*.009+y*.006+t*.0011)*.32;
    return {x:-dy*swirl*.012+1.05+wave,y:dx*swirl*.012+Math.cos(y*.011-t*.0008)*.28};
  }

  function draw(t){
    frame=requestAnimationFrame(draw);
    ctx.fillStyle='rgba(4,7,11,.065)';ctx.fillRect(0,0,width,height);
    ctx.lineWidth=.72;
    for(const p of particles){
      const v=velocity(p.x,p.y,t);
      p.px=p.x;p.py=p.y;p.x+=v.x;p.y+=v.y;p.age++;
      if(p.x<-20||p.x>width+20||p.y<-20||p.y>height+20||p.age>p.life){reset(p,false);continue}
      const fade=Math.min(1,p.age/40,(p.life-p.age)/50);
      ctx.strokeStyle=`rgba(${p.tint},${Math.max(0,fade)*.18})`;
      ctx.beginPath();ctx.moveTo(p.px,p.py);ctx.lineTo(p.x,p.y);ctx.stroke();
    }
  }

  addEventListener('resize',resize,{passive:true});
  addEventListener('pagehide',()=>cancelAnimationFrame(frame),{once:true});
  resize();requestAnimationFrame(draw);
})();
