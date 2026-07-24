// easy mode: a smaller, friendlier front-end over copyparty's own engine.
//
// this is presentation only. selection is stored on the (hidden) #files
// rows and handed to msel, so rename / delete / cut / copy / paste /
// share / zip / multi-download are the exact same code paths the expert
// ui uses -- easy mode never reimplements them, it just offers them in
// fewer, larger buttons.

var ezmode = (function () {
	var r = {},
		box = null,
		ovl = null,
		items = [],
		shown = -1,
		filt = '',
		view = 'grid',
		upwatch = null,
		upactive = false;

	r.on = false;

	function esc2(s) {
		return (s + '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
			.replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	function tl(k, fb) {
		return L[k] || fb;
	}

	function fmtsz(v) {
		// the table renders byte counts with digit grouping ("1 877")
		var n = parseInt((v + '').replace(/[^0-9]/g, ''), 10);
		if (isNaN(n))
			return '';

		var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0;
		while (n >= 1024 && i < u.length - 1) {
			n /= 1024;
			i++;
		}
		return (i ? n.toFixed(n < 10 ? 1 : 0) : n) + ' ' + u[i];
	}

	function ext(name) {
		return (name.indexOf('.') + 1 ? name.split('.').pop() : '').toLowerCase();
	}

	function kind(name) {
		var e = ext(name);
		if (/^(jpe?g|png|gif|webp|bmp|svg|avif|jxl|heic)$/.test(e)) return 'img';
		if (/^(mp3|flac|ogg|opus|m4a|wav|aac|wma)$/.test(e)) return 'audio';
		if (/^(mp4|mkv|webm|mov|avi|m4v|wmv)$/.test(e)) return 'video';
		if (/^(pdf)$/.test(e)) return 'pdf';
		if (/^(zip|rar|7z|tar|gz|xz|bz2|zst)$/.test(e)) return 'zip';
		if (/^(txt|md|log|json|xml|csv|ini|cfg|yml|yaml|html?|js|css|py|sh|c|h|cpp|rs|go)$/.test(e)) return 'text';
		return 'file';
	}

	// only ever offer what the server already permits
	function may(p) {
		return typeof perms !== 'undefined' && has(perms, p);
	}

	// ---- listing -------------------------------------------------------

	// map the table's columns by their header name, since the tag columns
	// in between are volume-dependent
	function cols() {
		var th = QSA('#files thead th'),
			m = {};

		for (var a = 0; a < th.length; a++)
			m[th[a].getAttribute('name')] = a;

		return m;
	}

	// read from the #files table, not treectl.lsc: lsc is only filled by
	// the ajax path (so it is empty on first load) and the table already
	// reflects the active sort order
	function scan() {
		var rows = QSA('#files tbody tr'),
			c = cols(),
			out = [];

		for (var a = 0, aa = rows.length; a < aa; a++) {
			var td = rows[a].cells[1],
				link = td && td.getElementsByTagName('a')[0];

			if (!link)
				continue;

			var href = link.getAttribute('href') || '',
				cell = function (k) {
					var i = c[k];
					return i !== undefined && rows[a].cells[i] ?
						rows[a].cells[i].textContent.trim() : '';
				};

			out.push({
				tr: rows[a],
				href: href,
				name: link.textContent,
				sz: cell('sz'),
				ext: cell('ext'),
				ts: cell('ts'),
				dir: href.split('?')[0].slice(-1) == '/'
			});
		}
		return out;
	}

	function visible() {
		if (!filt)
			return items;

		var o = [];
		for (var a = 0; a < items.length; a++)
			if (items[a].name.toLowerCase().indexOf(filt) + 1)
				o.push(items[a]);

		return o;
	}

	// push our selection into copyparty's own selection model
	function sync() {
		msel.origin_id(null);
		msel.selui();
		paint();
	}

	function pick(i, on) {
		clmod(items[i].tr, 'sel', on === undefined ? 't' : on);
	}

	function nsel() {
		var n = 0;
		for (var a = 0; a < items.length; a++)
			if (items[a].tr.className.indexOf('sel') + 1)
				n++;
		return n;
	}

	// ---- rendering -----------------------------------------------------

	r.crumbs = function () {
		var parts = get_evpath().split('/'),
			link = '',
			h = ['<button class="ez_crumb" data-h="' + esc2(SR + '/') + '">' +
				esc2(tl('ez_home', 'Home')) + '</button>'];

		for (var a = 1; a < parts.length - 1; a++) {
			link += parts[a] + '/';
			h.push('<span class="ez_sep"></span>');
			h.push('<button class="ez_crumb" data-h="' + esc2(link) + '">' +
				esc2(uricom_dec(parts[a])) + '</button>');
		}
		return h.join('');
	};

	// parent folder of the current path; stays put at the site root
	r.parent = function () {
		return get_evpath().replace(/[^/]+\/+$/, '') || '/';
	};

	r.atRoot = function () {
		return r.parent() === get_evpath();
	};

	function btn(id, ico, label, cls) {
		return '<button class="ez_btn ' + (cls || '') + '" id="' + id + '">' +
			(ico ? '<i class="ez_i ez_i_' + ico + '"></i>' : '') + esc2(label) + '</button>';
	}

	r.render = function () {
		if (!r.on || !box)
			return;

		items = scan();
		var vis = visible(),
			h = [];

		// --- header
		h.push('<div class="ez_bar">');
		h.push('<div class="ez_path">' + r.crumbs() + '</div>');
		h.push('<div class="ez_search"><i class="ez_i ez_i_search"></i>' +
			'<input type="text" id="ez_q" autocomplete="off" spellcheck="false" placeholder="' +
			esc2(tl('ez_searchph', 'Search this folder')) + '" value="' + esc2(filt) + '" />' +
			'<button id="ez_qx" class="ez_qx"><i class="ez_i ez_i_x"></i></button></div>');

		// login sits right after the search, styled like the primary
		// upload button so it is easy to spot; logout goes via ?h
		var who = (typeof acct !== 'undefined') ? acct : '*';
		if (who == '*')
			h.push('<a class="ez_btn ez_pri ez_login" href="?h">' +
				'<i class="ez_i ez_i_login"></i>' + esc2(tl('ez_login', 'Login')) + '</a>');
		else
			h.push('<a class="ez_btn ez_ghost ez_login" href="?h" title="' +
				esc2(tl('ez_account', 'Account')) + '"><i class="ez_i ez_i_user"></i>' +
				esc2(who) + '</a>');
		h.push('</div>');

		h.push('<div class="ez_bar ez_bar2">');
		h.push('<button class="ez_btn ez_back" id="ez_back"' +
			(r.atRoot() ? ' disabled' : '') + ' title="' + esc2(tl('ez_back', 'Back')) +
			'"><i class="ez_i ez_i_back"></i></button>');
		if (may('write')) {
			h.push(btn('ez_up', 'up', tl('ez_upload', 'Upload'), 'ez_pri'));
			h.push(btn('ez_mkdir', 'folderadd', tl('ez_newdir', 'New folder')));
			h.push(btn('ez_mkfile', 'fileadd', tl('ez_newfile', 'New file')));
		}
		if (fileman.clip && fileman.clip.length && may('write'))
			h.push(btn('ez_paste', 'paste', tl('ez_paste', 'Paste') +
				' (' + fileman.clip.length + ')'));
		h.push('<span class="ez_gap"></span>');
		if (typeof have_zip === 'undefined' || have_zip)
			h.push(btn('ez_zipall', 'zip', tl('ez_zip', 'Download all')));
		h.push('<button class="ez_btn ez_icob" id="ez_view" title="' +
			esc2(tl('ez_view', 'Switch view')) + '"><i class="ez_i ez_i_' +
			(view == 'grid' ? 'list' : 'grid') + '"></i></button>');
		h.push('<button class="ez_btn ez_ghost" id="ez_expert">' +
			esc2(tl('ez_expert', 'Expert mode')) + '</button>');
		h.push('</div>');

		// --- contextual actions
		h.push('<div class="ez_selbar" id="ez_selbar">');
		h.push('<span class="ez_seln" id="ez_seln"></span>');
		h.push(btn('ez_dl', 'dl', tl('ez_download', 'Download')));
		if (typeof have_zip === 'undefined' || have_zip)
			h.push(btn('ez_zipsel', 'zip', tl('ez_zipsel', 'Download as zip')));
		if (typeof can_shr !== 'undefined' && can_shr)
			h.push(btn('ez_shr', 'share', tl('ez_share', 'Share')));
		if (may('move')) {
			h.push(btn('ez_ren', 'pen', tl('ez_rename', 'Rename')));
			h.push(btn('ez_cut', 'cut', tl('ez_cut', 'Cut')));
		}
		h.push(btn('ez_cpy', 'copy', tl('ez_copy', 'Copy')));
		if (may('delete'))
			h.push(btn('ez_del', 'trash', tl('ez_delete', 'Delete'), 'ez_dang'));
		h.push(btn('ez_clr', '', tl('ez_clear', 'Clear'), 'ez_ghost'));
		h.push('</div>');

		if (!vis.length)
			h.push('<div class="ez_empty">' + esc2(filt ?
				tl('ez_nohit', 'Nothing matches your search') :
				tl('ez_empty', 'This folder is empty')) + '</div>');

		// same negotiation the expert grid uses; falls back to jpeg
		var thq = 'th=' + (window.have_jxl ? 'x' : window.have_webp === false ? 'j' : 'w');

		if (view == 'list') {
			h.push('<table class="ez_list"><thead><tr><th class="ez_c"></th><th>' +
				esc2(tl('ez_cname', 'Name')) + '</th><th>' +
				esc2(tl('ez_cdate', 'Date')) + '</th><th>' +
				esc2(tl('ez_ctype', 'Type')) + '</th><th class="ez_r">' +
				esc2(tl('ez_csize', 'Size')) + '</th></tr></thead><tbody>');

			for (var a = 0; a < vis.length; a++) {
				var it = vis[a],
					i = items.indexOf(it),
					nm = it.dir ? it.name.replace(/\/$/, '') : it.name,
					k = it.dir ? 'folder' : kind(nm);

				h.push('<tr class="ez_row" data-i="' + i + '">' +
					'<td class="ez_c"><button class="ez_chk" data-i="' + i + '"></button></td>' +
					'<td class="ez_nmc"><i class="ez_i ez_i_' + k + '"></i><span>' +
					esc2(nm) + '</span></td>' +
					'<td class="ez_dim">' + esc2(it.ts) + '</td>' +
					'<td class="ez_dim">' + esc2(it.dir ? tl('ez_folder', 'Folder') : it.ext) + '</td>' +
					'<td class="ez_r ez_dim">' + esc2(it.dir ? '' : fmtsz(it.sz)) + '</td>' +
					'</tr>');
			}
			h.push('</tbody></table>');
		}
		else {
			h.push('<div class="ez_grid">');
			for (var a = 0; a < vis.length; a++) {
				var it = vis[a],
					i = items.indexOf(it),
					nm = it.dir ? it.name.replace(/\/$/, '') : it.name,
					k = it.dir ? 'folder' : kind(nm),
					// audio gets a spectrogram, so it is worth a thumb too
					th = !it.dir && (k == 'img' || k == 'video' || k == 'audio');

				h.push('<div class="ez_tile ' + (it.dir ? 'ez_dir' : 'ez_file') + '" data-i="' + i + '">' +
					'<button class="ez_chk" data-i="' + i + '" title="' +
					esc2(tl('ez_select', 'Select')) + '"></button>' +
					'<span class="ez_thumb">' +
					'<i class="ez_i ez_i_' + k + '"></i>' +
					(th ? '<img class="ez_th" loading="lazy" alt="" src="' +
						esc2(addq(it.href, thq)) + '" />' : '') +
					'</span>' +
					'<span class="ez_nm">' + esc2(nm) + '</span>' +
					'<span class="ez_meta">' + esc2(it.dir ? tl('ez_folder', 'Folder') : fmtsz(it.sz)) + '</span>' +
					'</div>');
			}
			h.push('</div>');
		}

		box.innerHTML = h.join('');
		r.wire();
		paint();
	};

	// reflect selection without rebuilding the grid
	function paint() {
		var els = QSA('#ez .ez_tile, #ez .ez_row'),
			n = 0;

		for (var a = 0; a < els.length; a++) {
			var i = parseInt(els[a].getAttribute('data-i'), 10),
				on = items[i] && items[i].tr.className.indexOf('sel') + 1;

			clmod(els[a], 'on', on);
			if (on)
				n++;
		}

		clmod(box, 'picking', n);
		var bar = ebi('ez_selbar');
		if (bar)
			clmod(bar, 'act', n);

		var lbl = ebi('ez_seln');
		if (lbl)
			lbl.textContent = tl('ez_nsel', '{0} selected').format(n);

		var b = ebi('ez_ren');
		if (b)
			b.disabled = n != 1;

		b = ebi('ez_shr');
		if (b)
			b.disabled = !n;
	}

	r.wire = function () {
		var a, els;

		els = QSA('#ez .ez_crumb');
		for (a = 0; a < els.length; a++)
			els[a].onclick = function (e) {
				ev(e);
				filt = '';
				treectl.reqls(this.getAttribute('data-h'), true);
			};

		// a thumb that fails to generate just reveals the icon behind it
		els = QSA('#ez .ez_th');
		for (a = 0; a < els.length; a++) {
			els[a].onerror = function () { this.style.display = 'none'; };
			els[a].onload = function () { clmod(this.parentNode, 'has', 1); };
		}

		els = QSA('#ez .ez_chk');
		for (a = 0; a < els.length; a++)
			els[a].onclick = function (e) {
				ev(e);
				pick(parseInt(this.getAttribute('data-i'), 10));
				sync();
			};

		els = QSA('#ez .ez_tile, #ez .ez_row');
		for (a = 0; a < els.length; a++)
			els[a].onclick = function (e) {
				var i = parseInt(this.getAttribute('data-i'), 10);
				if (ctrl(e) || e.shiftKey || box.className.indexOf('picking') + 1) {
					ev(e);
					pick(i);
					return sync();
				}
				ev(e);
				r.open(i);
			};

		var q = ebi('ez_q');
		if (q) {
			q.oninput = function () {
				filt = this.value.toLowerCase();
				var at = this.selectionStart;
				r.render();
				var n = ebi('ez_q');
				n.focus();
				try { n.setSelectionRange(at, at); } catch (ex) { }
			};
			q.onkeydown = function (e) {
				if ((e.key == 'Escape' || e.keyCode == 27) && filt) {
					ev(e);
					filt = '';
					r.render();
				}
			};
		}

		var b = ebi('ez_qx');
		if (b) b.onclick = function (e) { ev(e); filt = ''; r.render(); };

		b = ebi('ez_back');
		if (b) b.onclick = function (e) {
			ev(e);
			if (!r.atRoot()) {
				filt = '';
				treectl.reqls(r.parent(), true);
			}
		};

		b = ebi('ez_up');
		if (b) b.onclick = function (e) { ev(e); r.upload(); };

		b = ebi('ez_mkdir');
		if (b) b.onclick = function (e) { ev(e); r.mk(true); };

		b = ebi('ez_mkfile');
		if (b) b.onclick = function (e) { ev(e); r.mk(false); };

		b = ebi('ez_zipall');
		if (b) b.onclick = function (e) { ev(e); r.zipall(); };

		b = ebi('ez_view');
		if (b) b.onclick = function (e) {
			ev(e);
			view = view == 'grid' ? 'list' : 'grid';
			swrite('ezview', view);
			r.render();
		};

		b = ebi('ez_expert');
		if (b) b.onclick = function (e) { ev(e); r.set(false); };

		// everything below delegates to the expert implementation
		b = ebi('ez_dl');
		if (b) b.onclick = function (e) { ev(e); ebi('seldl').click(); };

		b = ebi('ez_zipsel');
		if (b) b.onclick = function (e) { ev(e); ebi('selzip').click(); };

		b = ebi('ez_shr');
		if (b) b.onclick = function (e) { ev(e); fileman.share(e); };

		b = ebi('ez_ren');
		if (b) b.onclick = function (e) { ev(e); fileman.rename(e); };

		// the clipboard now holds them, so drop the selection: otherwise
		// the next click keeps picking instead of navigating
		b = ebi('ez_cut');
		if (b) b.onclick = function (e) { ev(e); fileman.cut(e); r.deselect(); };

		b = ebi('ez_cpy');
		if (b) b.onclick = function (e) { ev(e); fileman.cpy(e); r.deselect(); };

		b = ebi('ez_paste');
		if (b) b.onclick = function (e) { ev(e); fileman.paste(); };

		b = ebi('ez_del');
		if (b) b.onclick = function (e) { ev(e); fileman.delete(e); };

		b = ebi('ez_clr');
		if (b) b.onclick = function (e) { ev(e); r.deselect(); };
	};

	r.deselect = function () {
		for (var i = 0; i < items.length; i++)
			pick(i, 0);

		sync();
		r.render();
	};

	// ---- create --------------------------------------------------------

	// same request the expert right-click menu sends
	r.mk = function (is_dir) {
		modal.prompt(is_dir ? tl('ez_newdir', 'New folder') : tl('ez_newfile', 'New file'),
			'', function (name) {
				name = ('' + (name || '')).trim();
				if (!name)
					return;

				var data = new FormData();
				data.set('act', is_dir ? 'mkdir' : 'new_md');
				data.set('name', name);

				var req = new XHR();
				req.open('POST', get_evpath());
				req.onload = req.onerror = function () {
					if (this.status == 405 || this.status == 500)
						return toast.err(4, tl('ez_eexist', 'Something with that name already exists'));

					if (this.status < 200 || this.status > 399)
						return toast.err(6, esc(this.responseText));

					toast.ok(3, is_dir ? tl('ez_okdir', 'Folder created') :
						tl('ez_okfile', 'File created'));
					treectl.reqls(get_evpath(), false);
				};
				req.send(data);
			});
	};

	// ---- in-page viewer ------------------------------------------------

	// the ?v markdown viewer ships copyparty's own breadcrumb (#mn) and
	// editor toolbar (#mh); inside the modal those are just clutter, and
	// clicking "top" navigates the iframe itself -- loading the whole app
	// into the modal. hide the chrome and route any link through easy mode
	function tame(f) {
		var idoc;
		try { idoc = f.contentDocument; } catch (ex) { return; }
		if (!idoc)
			return;

		try {
			var st = idoc.createElement('style');
			st.textContent = '#mn,#mh{display:none!important}';
			idoc.head.appendChild(st);
		} catch (ex) { }

		idoc.addEventListener('click', function (e) {
			var a = e.target && e.target.closest && e.target.closest('a[href]');
			if (!a)
				return;

			var href = a.getAttribute('href') || '';
			if (!href || href.charAt(0) === '#')
				return;

			var u;
			try { u = new URL(href, f.contentWindow.location.href); }
			catch (ex) { return; }

			// external links open in a new tab; don't hijack them
			if (u.origin !== location.origin) {
				a.target = '_blank';
				return;
			}

			e.preventDefault();
			r.close();
			if (/\/$/.test(u.pathname)) {
				filt = '';
				treectl.reqls(u.pathname, true);
			}
			else
				location.href = u.pathname + u.search;
		}, true);
	}

	function mkovl() {
		ovl = mknod('div', 'ezov');
		ovl.innerHTML =
			'<div class="ezov_top">' +
			'<span class="ezov_nm" id="ezov_nm"></span>' +
			'<a class="ezov_b" id="ezov_dl" download><i class="ez_i ez_i_dl"></i></a>' +
			'<button class="ezov_b" id="ezov_x"><i class="ez_i ez_i_x"></i></button>' +
			'</div>' +
			'<button class="ezov_nav ezov_prev" id="ezov_p"></button>' +
			'<div class="ezov_body" id="ezov_body"></div>' +
			'<button class="ezov_nav ezov_next" id="ezov_n"></button>';

		document.body.appendChild(ovl);

		ebi('ezov_x').onclick = r.close;
		ebi('ezov_p').onclick = function (e) { ev(e); r.step(-1); };
		ebi('ezov_n').onclick = function (e) { ev(e); r.step(1); };
		ovl.onclick = function (e) {
			if (e.target === ovl)
				r.close(e);
		};
	}

	r.open = function (i) {
		var it = items[i];
		if (!it)
			return;

		if (it.dir) {
			filt = '';
			return treectl.reqls(it.href, true);
		}

		if (!ovl)
			mkovl();

		shown = i;
		clmod(ovl, 'act', 1);
		clmod(document.documentElement, 'ezov', 1);

		var nm = it.name,
			body = ebi('ezov_body'),
			k = kind(nm),
			e = ext(nm),
			url = it.href;

		ebi('ezov_nm').textContent = nm;
		ebi('ezov_dl').setAttribute('href', url + '?dl');
		body.innerHTML = '';

		if (k == 'img')
			body.innerHTML = '<img src="' + esc2(url) + '" alt="' + esc2(nm) + '" />';
		else if (k == 'video')
			body.innerHTML = '<video src="' + esc2(url) + '" controls autoplay playsinline></video>';
		else if (k == 'audio')
			body.innerHTML = '<div class="ezov_au"><i class="ez_i ez_i_audio"></i>' +
				'<audio src="' + esc2(url) + '" controls autoplay></audio></div>';
		else if (k == 'pdf')
			body.innerHTML = '<iframe src="' + esc2(url) + '"></iframe>';
		else if (k == 'text' && /^(md|markdown)$/.test(e)) {
			// copyparty's ?v viewer renders markdown nicely; but for plain
			// text it shows a blank page, so only route markdown here
			var vurl = /[?&]v(&|=|$)/.test(url) ? url : addq(url, 'v'),
				f = mknod('iframe');

			f.className = 'ezov_doc';
			f.onload = function () { tame(f); };
			f.setAttribute('src', vurl);
			body.appendChild(f);
		}
		else if (k == 'text') {
			// plain text / code: fetch the raw bytes and show them readably
			body.innerHTML = '<pre class="ezov_txt">…</pre>';
			var pre = QS('#ezov_body .ezov_txt'),
				xhr = new XHR();

			xhr.open('GET', addq(url, 'raw'), true);
			xhr.onload = function () {
				if (pre)
					pre.textContent = this.responseText;
			};
			xhr.onerror = function () {
				if (pre)
					pre.textContent = tl('ez_noprev', 'No preview available');
			};
			xhr.send();
		}
		else
			body.innerHTML = '<div class="ezov_no"><i class="ez_i ez_i_file"></i><span>' +
				esc2(tl('ez_noprev', 'No preview available')) + '</span></div>';

		var nfile = 0;
		for (var a = 0; a < items.length; a++)
			if (!items[a].dir)
				nfile++;

		ebi('ezov_p').style.display = ebi('ezov_n').style.display = nfile > 1 ? '' : 'none';
	};

	r.step = function (d) {
		if (shown < 0)
			return;

		for (var a = shown + d; a >= 0 && a < items.length; a += d)
			if (!items[a].dir)
				return r.open(a);
	};

	r.close = function (e) {
		ev(e);
		if (!ovl)
			return;

		var m = QS('#ezov_body video, #ezov_body audio');
		if (m) {
			try { m.pause(); } catch (ex) { }
		}
		ebi('ezov_body').innerHTML = '';
		clmod(ovl, 'act');
		clmod(document.documentElement, 'ezov');
		shown = -1;
	};

	// ---- actions -------------------------------------------------------

	// reuse up2k's own input so uploads stay resumable and verified
	r.upload = function () {
		var ins = QSA('#u2form input[type="file"]:not([webkitdirectory])');
		if (!ins.length)
			return toast.err(5, tl('ez_enoup', 'Uploads are not available here'));

		ins[ins.length - 1].click();
		r.watch();
	};

	r.zipall = function () {
		toast.inf(4, tl('ez_zipping', 'Preparing your download...'));
		location.href = get_evpath() + (window.dk ? '?k=' + dk + '&' : '?') + 'zip';
	};

	// up2k has no completion event, so watch its queues for active -> idle
	r.watch = function () {
		if (upwatch)
			return;

		upwatch = setInterval(function () {
			if (typeof up2k === 'undefined' || !up2k || !up2k.st)
				return;

			var st = up2k.st,
				n = st.todo.head.length + st.todo.hash.length +
					st.todo.handshake.length + st.todo.upload.length +
					st.busy.head.length + st.busy.hash.length +
					st.busy.handshake.length + st.busy.upload.length;

			if (n) {
				upactive = true;
				return;
			}
			if (!upactive)
				return;

			upactive = false;
			clearInterval(upwatch);
			upwatch = null;
			toast.ok(6, tl('ez_updone', 'Upload finished'));
			treectl.reqls(get_evpath(), false);
		}, 700);
	};

	// ---- mode ----------------------------------------------------------

	r.set = function (v) {
		r.on = !!v;
		swrite('ezmode', r.on ? 'y' : 'n');
		clmod(document.documentElement, 'ezmode', r.on);

		if (r.on) {
			if (!box) {
				box = mknod('div', 'ez');
				document.body.appendChild(box);
			}
			view = sread('ezview') == 'list' ? 'list' : 'grid';
			r.render();
			// up2k already owns body ondrop; watch so we can report the end
			document.body.addEventListener('drop', r.watch, true);
		}
		else {
			r.close();
			document.body.removeEventListener('drop', r.watch, true);
			if (box)
				box.innerHTML = '';
		}
	};

	r.toggle = function (e) {
		ev(e);
		r.set(!r.on);
	};

	r.key = function (e) {
		if (!r.on || shown < 0)
			return;

		var k = e.key || '';
		if (k == 'Escape' || k == 'Esc')
			return r.close(e);
		if (k == 'ArrowRight')
			return r.step(1);
		if (k == 'ArrowLeft')
			return r.step(-1);
	};

	return r;
})();


// boot: restore the saved mode, and give the expert ui a way in
(function () {
	var a = mknod('a');
	a.href = '#';
	a.id = 'ez_enter';
	a.textContent = L.ez_easy || 'Easy mode';
	a.onclick = ezmode.toggle;

	var ops = ebi('ops');
	if (ops)
		ops.appendChild(a);

	document.addEventListener('keydown', ezmode.key);

	if (sread('ezmode') == 'y')
		ezmode.set(true);
})();
