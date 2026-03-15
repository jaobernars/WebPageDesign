document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('left-sidebar');

    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            sidebar.classList.toggle('active');
        });
    }

    // --- Theme Toggle ---
    const themeToggleBtn = document.getElementById('theme-toggle');
    const themeIconSun = document.getElementById('theme-icon-sun');
    const themeIconMoon = document.getElementById('theme-icon-moon');

    if (themeToggleBtn) {
        const savedTheme = localStorage.getItem('theme') || 'dark';
        if (savedTheme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
            themeIconSun.style.display = 'none';
            themeIconMoon.style.display = 'block';
        }

        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
            
            if (currentTheme === 'dark') {
                document.documentElement.setAttribute('data-theme', 'light');
                localStorage.setItem('theme', 'light');
                themeIconSun.style.display = 'none';
                themeIconMoon.style.display = 'block';
            } else {
                document.documentElement.removeAttribute('data-theme');
                localStorage.setItem('theme', 'dark');
                themeIconMoon.style.display = 'none';
                themeIconSun.style.display = 'block';
            }
        });
    }

    // Scroll Spy da TOC (Sidebar Direita)
    const tocLinks = document.querySelectorAll('.toc-container li a');
    const sections = Array.from(tocLinks).map(link => {
        const id = link.getAttribute('href');
        return id.startsWith('#') && id !== '#' ? document.querySelector(id) : null;
    }).filter(Boolean);

    window.addEventListener('scroll', () => {
        let currentId = '';
        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            if (scrollY >= sectionTop - 90) {
                currentId = section.getAttribute('id');
            }
        });

        tocLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${currentId}`) {
                link.classList.add('active');
            }
        });
    });
    window.dispatchEvent(new Event('scroll'));

    // --- Funcionalidade de Pesquisa ---
    const searchTrigger = document.getElementById('search-trigger');
    const searchOverlay = document.getElementById('search-overlay');
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    const sidebarGroups = document.querySelectorAll('.sidebar-group');

    if (searchTrigger && searchOverlay && searchInput && searchResults) {
        const ul = document.createElement('ul');
        ul.style.listStyle = 'none';
        ul.style.padding = '0';
        ul.style.margin = '0';

        let searchItems = [];

        sidebarGroups.forEach(group => {
            const categoryName = group.querySelector('h3').innerText;
            const links = group.querySelectorAll('ul li a');

            links.forEach(link => {
                const li = document.createElement('li');
                li.style.marginBottom = '0.125rem';

                const a = document.createElement('a');
                a.href = link.href;
                a.className = 'search-item';

                a.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                    <div style="display:flex; flex-direction:column;">
                        <span style="font-weight:500; line-height:1.2;">${link.innerText}</span>
                        <span style="font-size:0.7rem; color:#71717a; margin-top:0.2rem;">${categoryName}</span>
                    </div>
                `;

                li.appendChild(a);
                ul.appendChild(li);

                searchItems.push({
                    liElement: li,
                    aElement: a,
                    title: link.innerText.toLowerCase(),
                    category: categoryName.toLowerCase()
                });
            });
        });

        searchResults.innerHTML = '';
        searchResults.appendChild(ul);

        let visibleItems = [];
        let selectedIndex = -1;

        function filterResults(query) {
            query = query.toLowerCase();
            visibleItems = [];

            searchItems.forEach(item => {
                const isMatch = item.title.includes(query) || item.category.includes(query);
                if (isMatch) {
                    item.liElement.style.display = 'block';
                    visibleItems.push(item);
                } else {
                    item.liElement.style.display = 'none';
                }
                item.aElement.classList.remove('selected');
            });
        }

        function updateSelection() {
            visibleItems.forEach((item, index) => {
                if (index === selectedIndex) {
                    item.aElement.classList.add('selected');
                    item.aElement.scrollIntoView({ block: 'nearest' });
                } else {
                    item.aElement.classList.remove('selected');
                }
            });
        }

        searchInput.addEventListener('input', (e) => {
            filterResults(e.target.value);
            selectedIndex = -1;
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (selectedIndex < visibleItems.length - 1) {
                    selectedIndex++;
                    updateSelection();
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (selectedIndex > 0) {
                    selectedIndex--;
                    updateSelection();
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < visibleItems.length) {
                    visibleItems[selectedIndex].aElement.click();
                }
            }
        });

        ul.addEventListener('click', (e) => {
            if (e.target.closest('.search-item')) {
                setTimeout(closeModal, 150);
            }
        });

        function openModal() {
            searchOverlay.classList.add('active');
            searchInput.value = '';
            filterResults('');
            selectedIndex = -1;
            setTimeout(() => searchInput.focus(), 50);
        }

        function closeModal() {
            searchOverlay.classList.remove('active');
            searchInput.blur();
        }

        searchTrigger.addEventListener('click', openModal);

        searchOverlay.addEventListener('click', (e) => {
            if (e.target === searchOverlay) closeModal();
        });

        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                searchOverlay.classList.contains('active') ? closeModal() : openModal();
            }
            if (e.key === 'Escape' && searchOverlay.classList.contains('active')) {
                closeModal();
            }
        });
    }

    // Breadcrumbs dinâmicos
    const breadcrumbCategory = document.getElementById('breadcrumb-category');
    const breadcrumbCurrent = document.getElementById('breadcrumb-current');

    function updateBreadcrumbs() {
        const activeLink = document.querySelector('.sidebar-group li a.active');
        if (activeLink) {
            const groupH3 = activeLink.closest('.sidebar-group').querySelector('h3');
            if (groupH3 && breadcrumbCategory) {
                breadcrumbCategory.innerText = groupH3.innerText;
            }
            if (breadcrumbCurrent) {
                breadcrumbCurrent.innerText = activeLink.innerText;
            }
        }
    }

    updateBreadcrumbs();
});