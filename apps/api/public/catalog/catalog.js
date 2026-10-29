/* Catálogo público de Xiro Style.
 * Rutas: /catalog/:slug  y  /catalog/:slug/item/:id
 * Todo el contenido dinámico se inserta con textContent / atributos (nunca innerHTML): sin XSS por datos del negocio.
 */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var es = (navigator.language || 'es').toLowerCase().indexOf('es') === 0;
  var T = es
    ? {
        loading: 'Cargando…',
        all: 'Todas',
        empty: 'No hay artículos disponibles en esta categoría.',
        detail: 'Ver detalle',
        request: 'Solicitar por WhatsApp',
        back: '← Catálogo',
        goneTitle: 'Este producto ya no está disponible',
        goneBody: 'Puede volver al catálogo para conocer las opciones actuales.',
        notFoundTitle: 'Catálogo no encontrado',
        notFoundBody: 'Revisa el enlace que te compartieron.',
        errorTitle: 'No pudimos cargar el catálogo',
        errorBody: 'Inténtalo de nuevo en unos minutos.',
        view: 'Ver catálogo',
        tagline: 'Servicios y productos para tu estilo.',
        photoOf: 'Foto de ',
        hello: 'Hola, quiero solicitar: ',
        seen: 'Vi este catálogo en el enlace que me compartieron.',
        book: 'Reservar en línea',
      }
    : {
        loading: 'Loading…',
        all: 'All',
        empty: 'No items available in this category.',
        detail: 'View details',
        request: 'Request via WhatsApp',
        back: '← Catalog',
        goneTitle: 'This product is no longer available',
        goneBody: 'Go back to the catalog to see the current options.',
        notFoundTitle: 'Catalog not found',
        notFoundBody: 'Check the link you were given.',
        errorTitle: 'We could not load the catalog',
        errorBody: 'Please try again in a few minutes.',
        view: 'View catalog',
        tagline: 'Services and products for your style.',
        photoOf: 'Photo of ',
        hello: 'Hello, I would like to request: ',
        seen: 'I saw this catalog in the link you shared with me.',
        book: 'Book online',
      };

  var parts = location.pathname.split('/').filter(Boolean); // ['catalog', slug, 'item', id]
  var slug = decodeURIComponent(parts[1] || '');
  var itemId = parts[2] === 'item' && parts[3] ? decodeURIComponent(parts[3]) : null;
  var params = new URLSearchParams(location.search);
  var activeCategory = params.get('category') || '';
  var catalogHref = '/catalog/' + encodeURIComponent(slug);

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        if (key === 'text') node.textContent = props[key];
        else if (key === 'class') node.className = props[key];
        else node.setAttribute(key, props[key]);
      });
    }
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  function money(amount, currency) {
    var locales = { COP: 'es-CO', USD: 'en-US', MXN: 'es-MX', EUR: 'es-ES' };
    try {
      return new Intl.NumberFormat(locales[currency] || undefined, { style: 'currency', currency: currency, maximumFractionDigits: 0 }).format(amount);
    } catch (e) {
      return String(amount);
    }
  }

  function requestLink(business, item) {
    if (!business.whatsapp) return null;
    var text = T.hello + item.name + ' — ' + money(item.price, business.currency) + '. ' + T.seen;
    return 'https://wa.me/' + encodeURIComponent(business.whatsapp) + '?text=' + encodeURIComponent(text);
  }

  function photo(url, alt) {
    if (!url) return el('div', { class: 'photo placeholder', role: 'img', 'aria-label': alt });
    return el('img', { class: 'photo', alt: alt, loading: 'lazy', src: url });
  }

  function notice(title, body, withLink) {
    var box = el('div', { class: 'notice' }, [el('h2', { text: title }), el('p', { class: 'muted', text: body })]);
    if (withLink) box.appendChild(el('a', { class: 'button', href: catalogHref, text: T.view }));
    app.replaceChildren(box);
  }

  /* Marca del negocio: los tonos ya vienen calculados por el servidor (contraste AA garantizado); solo se copian a variables
   * CSS (CSSOM, permitido por la política de seguridad). Claro = --bl-*, oscuro = --bd-*. Sin marca, el dorado de la hoja. */
  function applyBrand(brand) {
    if (!brand || !brand.light || !brand.dark) return;
    var names = { accent: 'accent', onAccent: 'on-accent', accentText: 'accent-text', accentBorder: 'accent-border', accentTint: 'accent-tint' };
    var root = document.documentElement.style;
    Object.keys(names).forEach(function (key) {
      if (typeof brand.light[key] === 'string') root.setProperty('--bl-' + names[key], brand.light[key]);
      if (typeof brand.dark[key] === 'string') root.setProperty('--bd-' + names[key], brand.dark[key]);
    });
  }

  function header(business) {
    var logo = business.logoUrl
      ? el('img', { src: business.logoUrl, alt: business.name })
      : el('div', { class: 'logo-fallback', 'aria-hidden': 'true', text: (business.name || '?').charAt(0).toUpperCase() });
    var nodes = [el('div', { class: 'brand' }, [logo, el('h1', { text: business.name })]), el('p', { class: 'tagline', text: T.tagline })];
    // Si el negocio publicó su página de reservas, el catálogo lleva a ella (la misma experiencia en ambos enlaces).
    if (business.bookingPath) nodes.push(el('p', { class: 'book-cta' }, [el('a', { class: 'button', href: business.bookingPath, text: T.book })]));
    return nodes;
  }

  function renderList(data) {
    var business = data.business;
    var categories = [];
    data.items.forEach(function (item) {
      if (categories.indexOf(item.category) === -1) categories.push(item.category);
    });

    var nodes = header(business);
    if (categories.length > 1) {
      var chips = el('nav', { class: 'chips', 'aria-label': T.all });
      var makeChip = function (label, value) {
        var href = value ? catalogHref + '?category=' + encodeURIComponent(value) : catalogHref;
        var chip = el('a', { class: 'chip', href: href, text: label });
        if (value === activeCategory) chip.setAttribute('aria-current', 'true');
        return chip;
      };
      chips.appendChild(makeChip(T.all, ''));
      categories.forEach(function (c) { chips.appendChild(makeChip(c, c)); });
      nodes.push(chips);
    }

    var shown = data.items.filter(function (item) { return !activeCategory || item.category === activeCategory; });
    if (shown.length === 0) {
      nodes.push(el('div', { class: 'notice', text: T.empty }));
    } else {
      var grid = el('section', { class: 'grid' });
      shown.forEach(function (item) {
        var detailHref = catalogHref + '/item/' + encodeURIComponent(item.id);
        var actions = el('div', { class: 'actions' }, [el('a', { class: 'button secondary', href: detailHref, text: T.detail })]);
        var link = requestLink(business, item);
        if (link) actions.appendChild(el('a', { class: 'button', href: link, rel: 'noopener', text: 'WhatsApp' }));
        grid.appendChild(
          el('article', { class: 'card' }, [
            photo(item.image, item.name),
            el('div', { class: 'body' }, [
              el('div', { class: 'category', text: item.category }),
              el('h2', { text: item.name }),
              el('p', { text: item.shortDescription }),
              el('div', { class: 'price', text: money(item.price, business.currency) }),
              actions,
            ]),
          ]),
        );
      });
      nodes.push(grid);
    }
    app.replaceChildren.apply(app, nodes);
  }

  function renderDetail(data) {
    var business = data.business;
    var item = data.item;
    var images = (item.image ? [item.image] : []).concat(item.gallery || []);
    var hero = el('div', { class: 'hero' });
    var main = photo(images[0] || null, item.name);
    hero.appendChild(main);

    var nodes = [
      el('a', { class: 'back', href: catalogHref, text: T.back }),
      hero,
    ];

    if (images.length > 1) {
      var thumbs = el('div', { class: 'thumbs' });
      images.forEach(function (url, index) {
        var button = el('button', { type: 'button', 'aria-label': T.photoOf + item.name }, [el('img', { src: url, alt: '' })]);
        if (index === 0) button.setAttribute('aria-current', 'true');
        button.addEventListener('click', function () {
          main.src = url;
          Array.prototype.forEach.call(thumbs.children, function (child) { child.removeAttribute('aria-current'); });
          button.setAttribute('aria-current', 'true');
        });
        thumbs.appendChild(button);
      });
      nodes.push(thumbs);
    }

    nodes.push(
      el('div', { class: 'category', text: item.category }),
      el('h2', { text: item.name }),
      el('p', { class: 'muted', text: item.description || item.shortDescription }),
    );
    if (item.detail) nodes.push(el('p', { text: item.detail }));
    nodes.push(el('div', { class: 'price', text: money(item.price, business.currency) }));
    var link = requestLink(business, item);
    if (link) nodes.push(el('a', { class: 'button', href: link, rel: 'noopener', text: T.request }));

    app.replaceChildren(el('article', { class: 'detail' }, nodes));
    document.title = item.name + ' | ' + business.name;
  }

  var url = '/api/public/catalog/' + encodeURIComponent(slug) + (itemId ? '/items/' + encodeURIComponent(itemId) : '');
  fetch(url, { headers: { Accept: 'application/json' } })
    .then(function (response) {
      if (response.status === 404) return { missing: true };
      if (!response.ok) throw new Error('http ' + response.status);
      return response.json();
    })
    .then(function (data) {
      if (data.missing) {
        if (itemId) notice(T.goneTitle, T.goneBody, true);
        else notice(T.notFoundTitle, T.notFoundBody, false);
        return;
      }
      applyBrand(data.business && data.business.brand);
      if (itemId) renderDetail(data);
      else {
        renderList(data);
        document.title = data.business.name + ' | Catálogo';
      }
    })
    .catch(function () {
      notice(T.errorTitle, T.errorBody, false);
    });
})();
