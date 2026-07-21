// easy mode: a deliberately small browse / upload / download surface for
// people who do not want copyparty's full control panel.
//
// this is a separate front-end, not a separate backend: navigation still
// goes through treectl, uploads still go through up2k (so resumable,
// multithreaded, hash-verified uploads all keep working), and archives
// still use the server's ?zip. only the presentation and the amount of
// exposed surface differ.

var ezmode = (function () {
	var r = {},
		box = null,
		upwatch = null,
		upactive = false;

	r.on = false;

	function esc(s) {
		return (s + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

	function kind(name) {
		var e = (name.indexOf('.') + 1 ? name.split('.').pop() : '').toLowerCase();
		if (/^(jpe?g|png|gif|webp|bmp|svg|avif|jxl|heic)$/.test(e)) return 'img';
		if (/^(mp3|flac|ogg|opus|m4a|wav|aac|wma)$/.test(e)) return 'audio';
		if (/^(mp4|mkv|webm|mov|avi|m4v|wmv)$/.test(e)) return 'video';
		if (/^(pdf)$/.test(e)) return 'pdf';
		if (/^(zip|rar|7z|tar|gz|xz|bz2|zst)$/.test(e)) return 'zip';
		if (/^(txt|md|log|json|xml|csv|ini|cfg|yml|yaml|html?|js|css|py)$/.test(e)) return 'text';
		return 'file';
	}

	// copyparty's own permission list; easy mode only ever offers what the
	// server already allows, it never invents access
	function may(p) {
		return typeof perms !== 'undefined' && has(perms, p);
	}

	function nav(href) {
		treectl.reqls(href, true);
	}

	r.crumbs = function () {
		var parts = get_evpath().split('/'),
			link = '',
			h = ['<button class="ez_crumb" data-h="' + esc(SR + '/') + '">' + L.ez_home + '</button>'];

		for (var a = 1; a < parts.length - 1; a++) {
			link += parts[a] + '/';
			h.push('<span class="ez_sep"></span>');
			h.push('<button class="ez_crumb" data-h="' + esc(link) + '">' +
				esc(uricom_dec(parts[a])) + '</button>');
		}
		return h.join('');
	};

	// read the listing from the #files table rather than treectl.lsc:
	// lsc is only populated by the ajax path, so it is empty on the
	// initial server-rendered load, and the table already reflects the
	// active sort order
	function scan() {
		var rows = QSA('#files tbody tr'),
			dirs = [], files = [];

		for (var a = 0, aa = rows.length; a < aa; a++) {
			var td = rows[a].cells[1],
				link = td && td.getElementsByTagName('a')[0];

			if (!link)
				continue;

			var href = link.getAttribute('href') || '',
				o = {
					href: href,
					name: link.textContent,
					sz: (rows[a].cells[2] || {}).textContent
				};

			(href.split('?')[0].slice(-1) == '/' ? dirs : files).push(o);
		}
		return { dirs: dirs, files: files };
	}

	r.render = function () {
		if (!r.on || !box)
			return;

		var lsc = scan(),
			dirs = lsc.dirs,
			files = lsc.files,
			h = [];

		h.push('<div class="ez_bar">');
		h.push('<div class="ez_path">' + r.crumbs() + '</div>');
		h.push('<div class="ez_acts">');
		if (may('write'))
			h.push('<button class="ez_btn ez_pri" id="ez_up">' +
				'<i class="ez_i ez_i_up"></i>' + esc(L.ez_upload) + '</button>');
		if (typeof have_zip === 'undefined' || have_zip)
			h.push('<button class="ez_btn" id="ez_zip">' +
				'<i class="ez_i ez_i_zip"></i>' + esc(L.ez_zip) + '</button>');
		h.push('<button class="ez_btn ez_ghost" id="ez_expert">' + esc(L.ez_expert) + '</button>');
		h.push('</div></div>');

		if (!dirs.length && !files.length)
			h.push('<div class="ez_empty">' + esc(L.ez_empty) + '</div>');

		h.push('<div class="ez_grid">');

		for (var a = 0; a < dirs.length; a++) {
			var d = dirs[a],
				nm = d.name.replace(/\/$/, '');

			h.push('<button class="ez_tile ez_dir" data-h="' + esc(d.href) + '">' +
				'<i class="ez_i ez_i_folder"></i>' +
				'<span class="ez_nm">' + esc(nm) + '</span>' +
				'<span class="ez_meta">' + esc(L.ez_folder) + '</span>' +
				'</button>');
		}

		for (var a = 0; a < files.length; a++) {
			var f = files[a],
				nm = f.name;

			h.push('<div class="ez_tile ez_file" data-h="' + esc(f.href) + '">' +
				'<i class="ez_i ez_i_' + kind(nm) + '"></i>' +
				'<span class="ez_nm">' + esc(nm) + '</span>' +
				'<span class="ez_meta">' + esc(fmtsz(f.sz)) + '</span>' +
				'<a class="ez_dl" href="' + esc(f.href) + '?dl" download title="' +
				esc(L.ez_dl) + '"><i class="ez_i ez_i_dl"></i></a>' +
				'</div>');
		}

		h.push('</div>');
		box.innerHTML = h.join('');
		r.wire();
	};

	r.wire = function () {
		var els = QSA('#ez .ez_crumb, #ez .ez_dir');
		for (var a = 0; a < els.length; a++)
			els[a].onclick = function (e) {
				ev(e);
				nav(this.getAttribute('data-h'));
			};

		els = QSA('#ez .ez_file');
		for (var a = 0; a < els.length; a++)
			els[a].onclick = function (e) {
				// the per-tile download link handles itself
				if (e.target.closest('.ez_dl'))
					return;

				ev(e);
				location.href = this.getAttribute('data-h');
			};

		var b = ebi('ez_up');
		if (b)
			b.onclick = function (e) { ev(e); r.upload(); };

		b = ebi('ez_zip');
		if (b)
			b.onclick = function (e) { ev(e); r.zip(); };

		b = ebi('ez_expert');
		if (b)
			b.onclick = function (e) { ev(e); r.set(false); };
	};

	// reuse up2k's own file input so uploads stay resumable and verified
	r.upload = function () {
		var ins = QSA('#u2form input[type="file"]:not([webkitdirectory])');
		if (!ins.length)
			return toast.err(5, L.ez_enoup);

		ins[ins.length - 1].click();
		r.watch();
	};

	r.zip = function () {
		var u = get_evpath() + (window.dk ? '?k=' + dk + '&' : '?') + 'zip';
		toast.inf(4, L.ez_zipping);
		location.href = u;
	};

	// up2k has no completion event, so watch its queues and report the
	// active -> idle transition
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
			toast.ok(6, L.ez_updone);
			treectl.reqls(get_evpath(), false);
		}, 700);
	};

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
		else if (box) {
			box.innerHTML = '';
		}
	};

	r.toggle = function (e) {
		ev(e);
		r.set(!r.on);
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

	if (sread('ezmode') == 'y')
		ezmode.set(true);
})();
