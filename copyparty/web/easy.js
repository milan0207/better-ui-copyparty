// easy mode: a smaller, friendlier front-end over copyparty's own engine.
//
// this is presentation only. selection is stored on the (hidden) #files
// rows and handed to msel, so rename / delete / zip / multi-download are
// the exact same code paths the expert ui uses -- easy mode never
// reimplements them, it just offers them in fewer, larger buttons.

var ezmode = (function () {
	var r = {},
		box = null,
		ovl = null,
		items = [],
		shown = -1,
		upwatch = null,
		upactive = false;

	r.on = false;

	function esc(s) {
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

	// read from the #files table, not treectl.lsc: lsc is only filled by
	// the ajax path (so it is empty on first load) and the table already
	// reflects the active sort order
	function scan() {
		var rows = QSA('#files tbody tr'),
			out = [];

		for (var a = 0, aa = rows.length; a < aa; a++) {
			var td = rows[a].cells[1],
				link = td && td.getElementsByTagName('a')[0];

			if (!link)
				continue;

			var href = link.getAttribute('href') || '';
			out.push({
				tr: rows[a],
				href: href,
				name: link.textContent,
				sz: (rows[a].cells[2] || {}).textContent,
				dir: href.split('?')[0].slice(-1) == '/'
			});
		}
		return out;
	}

	function selected() {
		var o = [];
		for (var a = 0; a < items.length; a++)
			if (items[a].tr.className.indexOf('sel') + 1)
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

	// ---- rendering -----------------------------------------------------

	r.crumbs = function () {
		var parts = get_evpath().split('/'),
			link = '',
			h = ['<button class="ez_crumb" data-h="' + esc(SR + '/') + '">' +
				esc(tl('ez_home', 'Home')) + '</button>'];

		for (var a = 1; a < parts.length - 1; a++) {
			link += parts[a] + '/';
			h.push('<span class="ez_sep"></span>');
			h.push('<button class="ez_crumb" data-h="' + esc(link) + '">' +
				esc(uricom_dec(parts[a])) + '</button>');
		}
		return h.join('');
	};

	r.render = function () {
		if (!r.on || !box)
			return;

		items = scan();
		var h = [];

		h.push('<div class="ez_bar">');
		h.push('<div class="ez_path">' + r.crumbs() + '</div>');
		h.push('<div class="ez_acts">');
		if (may('write'))
			h.push('<button class="ez_btn ez_pri" id="ez_up"><i class="ez_i ez_i_up"></i>' +
				esc(tl('ez_upload', 'Upload')) + '</button>');
		if (typeof have_zip === 'undefined' || have_zip)
			h.push('<button class="ez_btn" id="ez_zipall"><i class="ez_i ez_i_zip"></i>' +
				esc(tl('ez_zip', 'Download all')) + '</button>');
		h.push('<button class="ez_btn ez_ghost" id="ez_expert">' +
			esc(tl('ez_expert', 'Expert mode')) + '</button>');
		h.push('</div></div>');

		// contextual action bar; visibility is toggled in paint()
		h.push('<div class="ez_selbar" id="ez_selbar">');
		h.push('<span class="ez_seln" id="ez_seln"></span>');
		h.push('<button class="ez_btn" id="ez_dl"><i class="ez_i ez_i_dl"></i>' +
			esc(tl('ez_download', 'Download')) + '</button>');
		if (typeof have_zip === 'undefined' || have_zip)
			h.push('<button class="ez_btn" id="ez_zipsel"><i class="ez_i ez_i_zip"></i>' +
				esc(tl('ez_zipsel', 'Download as zip')) + '</button>');
		if (may('move'))
			h.push('<button class="ez_btn" id="ez_ren"><i class="ez_i ez_i_pen"></i>' +
				esc(tl('ez_rename', 'Rename')) + '</button>');
		if (may('delete'))
			h.push('<button class="ez_btn ez_dang" id="ez_del"><i class="ez_i ez_i_trash"></i>' +
				esc(tl('ez_delete', 'Delete')) + '</button>');
		h.push('<button class="ez_btn ez_ghost" id="ez_clr">' +
			esc(tl('ez_clear', 'Clear')) + '</button>');
		h.push('</div>');

		if (!items.length)
			h.push('<div class="ez_empty">' + esc(tl('ez_empty', 'This folder is empty')) + '</div>');

		// same negotiation the expert grid uses; falls back to jpeg
		var thq = 'th=' + (window.have_jxl ? 'x' : window.have_webp === false ? 'j' : 'w');

		h.push('<div class="ez_grid">');
		for (var a = 0; a < items.length; a++) {
			var it = items[a],
				nm = it.dir ? it.name.replace(/\/$/, '') : it.name,
				k = it.dir ? 'folder' : kind(nm),
				// audio gets a spectrogram, so it is worth a thumb too
				th = !it.dir && (k == 'img' || k == 'video' || k == 'audio');

			h.push('<div class="ez_tile ' + (it.dir ? 'ez_dir' : 'ez_file') + '" data-i="' + a + '">' +
				'<button class="ez_chk" data-i="' + a + '" title="' +
				esc(tl('ez_select', 'Select')) + '"></button>' +
				'<span class="ez_thumb">' +
				'<i class="ez_i ez_i_' + k + '"></i>' +
				(th ? '<img class="ez_th" loading="lazy" alt="" src="' +
					esc(addq(it.href, thq)) + '" />' : '') +
				'</span>' +
				'<span class="ez_nm">' + esc(nm) + '</span>' +
				'<span class="ez_meta">' + esc(it.dir ? tl('ez_folder', 'Folder') : fmtsz(it.sz)) + '</span>' +
				'</div>');
		}
		h.push('</div>');

		box.innerHTML = h.join('');
		r.wire();
		paint();
	};

	// reflect selection state without rebuilding the grid
	function paint() {
		var tiles = QSA('#ez .ez_tile'),
			n = 0;

		for (var a = 0; a < tiles.length; a++) {
			var i = parseInt(tiles[a].getAttribute('data-i'), 10),
				on = items[i] && items[i].tr.className.indexOf('sel') + 1;

			clmod(tiles[a], 'on', on);
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

		var ren = ebi('ez_ren');
		if (ren)
			ren.disabled = n != 1;
	}

	r.wire = function () {
		var a, els;

		els = QSA('#ez .ez_crumb');
		for (a = 0; a < els.length; a++)
			els[a].onclick = function (e) {
				ev(e);
				treectl.reqls(this.getAttribute('data-h'), true);
			};

		// checkbox toggles selection; the tile body opens
		els = QSA('#ez .ez_chk');
		for (a = 0; a < els.length; a++)
			els[a].onclick = function (e) {
				ev(e);
				pick(parseInt(this.getAttribute('data-i'), 10));
				sync();
			};

		// a thumb that fails to generate just reveals the icon behind it
		els = QSA('#ez .ez_th');
		for (a = 0; a < els.length; a++) {
			els[a].onerror = function () { this.style.display = 'none'; };
			els[a].onload = function () { clmod(this.parentNode, 'has', 1); };
		}

		els = QSA('#ez .ez_tile');
		for (a = 0; a < els.length; a++)
			els[a].onclick = function (e) {
				var i = parseInt(this.getAttribute('data-i'), 10);

				// ctrl/shift/an active selection means "keep picking"
				if (ctrl(e) || e.shiftKey || box.className.indexOf('picking') + 1) {
					ev(e);
					pick(i);
					return sync();
				}
				ev(e);
				r.open(i);
			};

		var b = ebi('ez_up');
		if (b) b.onclick = function (e) { ev(e); r.upload(); };

		b = ebi('ez_zipall');
		if (b) b.onclick = function (e) { ev(e); r.zipall(); };

		b = ebi('ez_expert');
		if (b) b.onclick = function (e) { ev(e); r.set(false); };

		// these delegate straight to the expert implementations
		b = ebi('ez_dl');
		if (b) b.onclick = function (e) { ev(e); ebi('seldl').click(); };

		b = ebi('ez_zipsel');
		if (b) b.onclick = function (e) { ev(e); ebi('selzip').click(); };

		b = ebi('ez_ren');
		if (b) b.onclick = function (e) { ev(e); fileman.rename(e); };

		b = ebi('ez_del');
		if (b) b.onclick = function (e) { ev(e); fileman.delete(e); };

		b = ebi('ez_clr');
		if (b) b.onclick = function (e) {
			ev(e);
			for (var i = 0; i < items.length; i++)
				pick(i, 0);
			sync();
		};
	};

	// ---- in-page viewer ------------------------------------------------

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

		if (it.dir)
			return treectl.reqls(it.href, true);

		if (!ovl)
			mkovl();

		shown = i;
		clmod(ovl, 'act', 1);
		clmod(document.documentElement, 'ezov', 1);

		var nm = it.name,
			body = ebi('ezov_body'),
			k = kind(nm),
			url = it.href;

		ebi('ezov_nm').textContent = nm;
		ebi('ezov_dl').setAttribute('href', url + '?dl');
		body.innerHTML = '';

		if (k == 'img')
			body.innerHTML = '<img src="' + esc(url) + '" alt="' + esc(nm) + '" />';
		else if (k == 'video')
			body.innerHTML = '<video src="' + esc(url) + '" controls autoplay playsinline></video>';
		else if (k == 'audio')
			body.innerHTML = '<div class="ezov_au"><i class="ez_i ez_i_audio"></i>' +
				'<audio src="' + esc(url) + '" controls autoplay></audio></div>';
		else if (k == 'pdf')
			body.innerHTML = '<iframe src="' + esc(url) + '"></iframe>';
		else if (k == 'text') {
			body.innerHTML = '<pre class="ezov_txt">...</pre>';
			// ?raw skips the markdown/code viewer and gives us the bytes
			var xhr = new XHR();
			xhr.open('GET', addq(url, 'raw'), true);
			xhr.onload = function () {
				var pre = QS('#ezov_body .ezov_txt');
				if (pre)
					pre.textContent = this.responseText;
			};
			xhr.onerror = function () {
				var pre = QS('#ezov_body .ezov_txt');
				if (pre)
					pre.textContent = tl('ez_noprev', 'No preview available');
			};
			xhr.send();
		}
		else
			body.innerHTML = '<div class="ezov_no"><i class="ez_i ez_i_file"></i><span>' +
				esc(tl('ez_noprev', 'No preview available')) + '</span></div>';

		// only offer prev/next across previewable files
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

		// stop any media that is still playing
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
		clmod(document.documentElement, 'ez', r.on);

		if (r.on) {
			if (!box) {
				box = mknod('div', 'ez');
				document.body.appendChild(box);
			}
			r.render();
		}
		else {
			r.close();
			if (box)
				box.innerHTML = '';
		}
	};

	r.toggle = function (e) {
		ev(e);
		r.set(!r.on);
	};

	r.key = function (e) {
		if (!r.on)
			return;

		var k = e.key || '';
		if (shown >= 0) {
			if (k == 'Escape' || k == 'Esc')
				return r.close(e);
			if (k == 'ArrowRight')
				return r.step(1);
			if (k == 'ArrowLeft')
				return r.step(-1);
		}
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
