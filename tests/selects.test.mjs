import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSelects, destroySelects } from '../public/selects.js';

test('下拉菜单在弹窗边界内翻转、限制高度；重复挂载和销毁不遗留组件',t=>{
  const previous={TomSelect:globalThis.TomSelect,innerHeight:globalThis.innerHeight};
  t.after(()=>Object.assign(globalThis,previous));
  globalThis.innerHeight=800;
  let rect={top:650,bottom:690},boundary={top:100,bottom:740},created=0;
  const attributes=new Map(),classes=new Map();
  const select={hasAttribute:name=>attributes.has(name),getAttribute:name=>attributes.get(name),setAttribute:(name,value)=>attributes.set(name,value),removeAttribute:name=>attributes.delete(name),closest:()=>({getBoundingClientRect:()=>boundary})};
  const root={querySelectorAll:()=>[select]};
  globalThis.TomSelect=class{
    constructor(input,settings){
      created++;input.tomselect=this;this.settings=settings;this.input=input;
      this.control={getBoundingClientRect:()=>rect};this.dropdown={scrollHeight:300};
      this.focus_node={dataset:{}};
      this.control_input={setAttribute(){},addEventListener:(type,callback)=>{this.keydown=callback;}};
      this.dropdown_content={style:{}};this.wrapper={classList:{toggle:(name,value)=>classes.set(name,value)}};
    }
    on(event,callback){this.cleanup=callback;}
    hook(when,event,callback){this.positionDropdown=callback;}
    destroy(){this.cleanup();delete this.input.tomselect;}
  };
  mountSelects(root);mountSelects(root);assert.equal(created,1);
  assert.equal(select.tomselect.settings.allowEmptyOption,true);
  assert.equal(select.tomselect.settings.controlInput,null);
  assert.equal(attributes.get('aria-hidden'),'true');
  select.tomselect.positionDropdown();assert.equal(classes.get('dropup'),true);
  assert.equal(select.tomselect.dropdown_content.style.maxHeight,'240px');
  rect={top:150,bottom:190};select.tomselect.positionDropdown();assert.equal(classes.get('dropup'),false);
  boundary={top:100,bottom:300};select.tomselect.positionDropdown();
  assert.equal(select.tomselect.dropdown_content.style.maxHeight,'98px');
  destroySelects(root);assert.equal(select.tomselect,undefined);assert.equal(attributes.has('aria-hidden'),false);
  attributes.set('data-search','');mountSelects(root);assert.equal(select.tomselect.settings.controlInput,undefined);
  destroySelects(root);
  attributes.set('data-tags','');mountSelects(root);
  const tags=select.tomselect;
  assert.deepEqual(tags.settings.create('  学习  '),{value:'学习',text:'学习'});
  assert.equal(tags.settings.createFilter('  '),false);
  assert.equal(tags.settings.onDelete(),true);
  let prevented=false,stopped=false;
  tags.keydown({key:'Enter',preventDefault(){prevented=true;}});assert.equal(prevented,true);
  prevented=false;
  for(const composition of [{isComposing:true},{keyCode:229}]){
    tags.keydown({key:'Enter',...composition,stopImmediatePropagation(){stopped=true;},preventDefault(){prevented=true;}});
    assert.equal(stopped,true);assert.equal(prevented,false);
  }
  destroySelects(root);
});
