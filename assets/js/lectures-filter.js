document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.toolbar-tabs a[data-filter]');
    const listContainer = document.querySelector('.list-container');
    const items = Array.from(document.querySelectorAll('.list-item[data-category]'));

    // Store original order
    const originalOrder = items.map((item, i) => ({ el: item, index: i }));

    // ==================== STATE ====================
    let activeTab = 'all';
    let activeCategories = new Set(); // empty = all
    let activeStatus = 'all';
    let activeSort = 'default';

    // ==================== TABS ====================
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeTab = tab.getAttribute('data-filter');
            applyAll();
        });
    });

    // ==================== DROPDOWNS ====================
    const btnFilter = document.getElementById('btn-filter');
    const filterDropdown = document.getElementById('filter-dropdown');
    const btnSort = document.getElementById('btn-sort');
    const sortDropdown = document.getElementById('sort-dropdown');

    function toggleDropdown(dropdown) {
        const isOpen = dropdown.classList.contains('open');
        // Close all
        document.querySelectorAll('.dropdown-menu').forEach(d => d.classList.remove('open'));
        if (!isOpen) dropdown.classList.add('open');
    }

    btnFilter.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown(filterDropdown);
    });

    btnSort.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown(sortDropdown);
    });

    // Click outside to close
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown-wrapper')) {
            document.querySelectorAll('.dropdown-menu').forEach(d => d.classList.remove('open'));
        }
    });

    // Prevent dropdown close on internal click
    filterDropdown.addEventListener('click', (e) => e.stopPropagation());
    sortDropdown.addEventListener('click', (e) => e.stopPropagation());

    // ==================== DYNAMIC CATEGORY CHECKBOXES ====================
    // Collect unique categories from item-category spans
    const uniqueCodes = new Set();
    items.forEach(item => {
        const code = item.querySelector('.item-category')?.textContent.trim();
        if (code) uniqueCodes.add(code);
    });

    // Insert category checkboxes after "Todas as Categorias"
    const allCheckbox = filterDropdown.querySelector('input[value="all"]');
    const allLabel = allCheckbox.closest('.dropdown-item');
    const divider = allLabel.nextElementSibling; // the dropdown-divider

    const sortedCodes = Array.from(uniqueCodes).sort();
    sortedCodes.forEach(code => {
        const label = document.createElement('label');
        label.className = 'dropdown-item';
        label.innerHTML = `<input type="checkbox" value="${code}" checked> ${code}`;
        filterDropdown.insertBefore(label, divider);
    });

    const categoryCheckboxes = filterDropdown.querySelectorAll('input[type="checkbox"]:not([value="all"])');

    // "All" checkbox logic
    allCheckbox.addEventListener('change', () => {
        categoryCheckboxes.forEach(cb => { cb.checked = allCheckbox.checked; });
        updateCategoryState();
        applyAll();
    });

    categoryCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            const allChecked = Array.from(categoryCheckboxes).every(c => c.checked);
            const noneChecked = Array.from(categoryCheckboxes).every(c => !c.checked);
            allCheckbox.checked = allChecked;
            allCheckbox.indeterminate = !allChecked && !noneChecked;
            updateCategoryState();
            applyAll();
        });
    });

    function updateCategoryState() {
        activeCategories.clear();
        const checked = Array.from(categoryCheckboxes).filter(c => c.checked);
        if (checked.length === categoryCheckboxes.length || checked.length === 0) {
            // all or none = show all
        } else {
            checked.forEach(c => activeCategories.add(c.value));
        }
    }

    // ==================== STATUS FILTER ====================
    const statusRadios = filterDropdown.querySelectorAll('input[name="status-filter"]');
    statusRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            activeStatus = radio.value;
            applyAll();
        });
    });

    // ==================== CLEAR FILTERS ====================
    const btnClear = document.getElementById('btn-clear-filters');
    btnClear.addEventListener('click', () => {
        allCheckbox.checked = true;
        allCheckbox.indeterminate = false;
        categoryCheckboxes.forEach(cb => { cb.checked = true; });
        statusRadios.forEach(r => { r.checked = r.value === 'all'; });
        activeCategories.clear();
        activeStatus = 'all';

        // Reset tabs
        tabs.forEach(t => t.classList.remove('active'));
        tabs[0].classList.add('active');
        activeTab = 'all';

        // Reset sort
        activeSort = 'default';
        sortOptions.forEach(s => s.classList.toggle('active', s.dataset.sort === 'default'));

        // Remove active indicator from buttons
        btnFilter.classList.remove('has-filter');

        applyAll();
    });

    // ==================== SORT ====================
    const sortOptions = sortDropdown.querySelectorAll('.sort-option');
    sortOptions.forEach(opt => {
        opt.addEventListener('click', () => {
            sortOptions.forEach(s => s.classList.remove('active'));
            opt.classList.add('active');
            activeSort = opt.dataset.sort;
            applyAll();
            sortDropdown.classList.remove('open');
        });
    });

    // ==================== APPLY ALL ====================
    function getItemStatus(item) {
        const desc = item.querySelector('.item-content p')?.textContent.trim() || '';
        if (desc === '[Em Progresso]') return 'em-progresso';
        return 'completo';
    }

    function applyAll() {
        // 1. Filter
        let visible = items.filter(item => {
            const type = item.dataset.category; // lecture | class-lecture
            const code = item.querySelector('.item-category')?.textContent.trim();
            const status = getItemStatus(item);

            // Tab filter
            if (activeTab !== 'all' && type !== activeTab) return false;

            // Category code filter
            if (activeCategories.size > 0 && !activeCategories.has(code)) return false;

            // Status filter
            if (activeStatus !== 'all' && status !== activeStatus) return false;

            return true;
        });

        let hidden = items.filter(item => !visible.includes(item));

        // 2. Sort visible items
        let sorted = [...visible];
        switch (activeSort) {
            case 'name-asc':
                sorted.sort((a, b) => getTitle(a).localeCompare(getTitle(b)));
                break;
            case 'name-desc':
                sorted.sort((a, b) => getTitle(b).localeCompare(getTitle(a)));
                break;
            case 'category-asc':
                sorted.sort((a, b) => getCode(a).localeCompare(getCode(b)));
                break;
            case 'category-desc':
                sorted.sort((a, b) => getCode(b).localeCompare(getCode(a)));
                break;
            case 'status':
                sorted.sort((a, b) => {
                    const sa = getItemStatus(a) === 'completo' ? 0 : 1;
                    const sb = getItemStatus(b) === 'completo' ? 0 : 1;
                    return sa - sb;
                });
                break;
            default: // 'default' — original order
                sorted.sort((a, b) => {
                    return originalOrder.find(o => o.el === a).index - originalOrder.find(o => o.el === b).index;
                });
                break;
        }

        // 3. Re-render
        hidden.forEach(item => {
            item.style.display = 'none';
            item.style.animation = '';
        });

        sorted.forEach(item => {
            listContainer.appendChild(item);
            item.style.display = '';
            item.style.animation = 'fadeIn 0.3s ease forwards';
        });

        // 4. Active indicator on filter button
        const hasActiveFilter = activeCategories.size > 0 || activeStatus !== 'all';
        btnFilter.classList.toggle('has-filter', hasActiveFilter);

        // 5. Update count
        updateCount(sorted.length);
    }

    function getTitle(item) {
        return item.querySelector('h2')?.textContent.trim() || '';
    }

    function getCode(item) {
        return item.querySelector('.item-category')?.textContent.trim() || '';
    }

    function updateCount(count) {
        let countEl = document.querySelector('.filter-count');
        if (!countEl) {
            countEl = document.createElement('span');
            countEl.classList.add('filter-count');
            document.querySelector('.toolbar-tabs').appendChild(countEl);
        }
        countEl.textContent = `${count} item${count !== 1 ? 's' : ''}`;
    }

    // Initialize
    updateCount(items.length);
});
