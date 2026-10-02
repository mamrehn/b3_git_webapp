// Runs before the page is painted: theme and language, so nothing flickers.
(function () {
    var root = document.documentElement;
    try {
        var theme = localStorage.getItem('gw.theme');
        if (theme !== 'light' && theme !== 'dark') {
            theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        root.dataset.theme = theme;
        var lang = localStorage.getItem('gw.lang');
        if (lang === 'de' || lang === 'en') root.lang = lang;
    } catch (e) {
        root.dataset.theme = 'light';
    }
})();
