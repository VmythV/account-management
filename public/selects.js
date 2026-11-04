export function mountSelects(root=document){
  for(const select of root.querySelectorAll('select')){
    if(select.tomselect)continue;
    const tags=select.hasAttribute('data-tags');
    const picker=new TomSelect(select,{
      create:false,
      allowEmptyOption:true,
      hideSelected:false,
      maxOptions:null,
      closeAfterSelect:true,
      ...(select.hasAttribute('data-search')?{}:{controlInput:null}),
      onDelete:()=>false,
      render:{no_results:()=>'<div class="no-results">没有匹配的账号</div>'},
      ...(tags?{
        controlInput:'<input type="text" autocomplete="off" maxlength="50">',
        placeholder:'输入标签后按回车',
        create:input=>({value:input.trim(),text:input.trim()}),
        createFilter:input=>!!input.trim(),
        createOnBlur:true,
        persist:false,
        allowEmptyOption:false,
        hideSelected:true,
        openOnFocus:false,
        onDelete:()=>true,
        plugins:{remove_button:{title:'移除标签'}},
        render:{option_create:(data,escape)=>`<div class="create">添加标签「${escape(data.input.trim())}」</div>`,no_results:null},
      }:{}),
    });
    if(tags){
      picker.control_input.setAttribute('aria-describedby','new-tags-help');
      // IME confirmation belongs to the input method; Enter here must never submit the account form.
      picker.control_input.addEventListener('keydown',event=>{
        if(event.isComposing||event.keyCode===229){event.stopImmediatePropagation();return;}
        if(event.key==='Enter')event.preventDefault();
      },true);
    }
    select.setAttribute('aria-hidden','true');
    picker.on('destroy',()=>select.removeAttribute('aria-hidden'));
    picker.focus_node.dataset.selectId=select.id;
    if(select.hasAttribute('aria-label'))picker.focus_node.setAttribute('aria-label',select.getAttribute('aria-label'));
    // Keep menus inside the dialog's focus boundary, and open upwards near its bottom edge.
    picker.hook('after','positionDropdown',()=>{
      const rect=picker.control.getBoundingClientRect(),dialog=select.closest('dialog')?.getBoundingClientRect();
      const below=Math.min(innerHeight,dialog?.bottom??innerHeight)-rect.bottom-12;
      const above=rect.top-Math.max(0,dialog?.top??0)-12;
      const up=below<Math.min(240,picker.dropdown.scrollHeight)&&above>below;
      picker.wrapper.classList.toggle('dropup',up);
      picker.dropdown_content.style.maxHeight=Math.max(48,Math.min(240,up?above:below))+'px';
    });
  }
}

export function destroySelects(root=document){
  for(const select of root.querySelectorAll('select'))select.tomselect?.destroy();
}
