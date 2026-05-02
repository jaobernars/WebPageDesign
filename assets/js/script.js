// Aguarda a página carregar completamente
document.addEventListener('DOMContentLoaded', () => {
    
    // Pega o botão e a barra lateral no HTML
    const btnToggle = document.getElementById('btn-toggle-sidebar');
    const sidebar = document.querySelector('.sidebar');

    // Cria o evento de clique
    btnToggle.addEventListener('click', () => {
        // O "toggle" adiciona a classe se ela não existir, e remove se ela já estiver lá
        sidebar.classList.toggle('collapsed');
    });

});

// Lógica para Sidebar no Mobile com Overlay
document.addEventListener('DOMContentLoaded', () => {
    const sidebarEl = document.querySelector('.sidebar');
    const toggleBtnEl = document.getElementById('btn-toggle-sidebar');

    if (sidebarEl && toggleBtnEl) {
        // Criar overlay dinamicamente se não existir
        let overlay = document.querySelector('.sidebar-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'sidebar-overlay';
            document.body.appendChild(overlay);
        }

        // Remover eventos antigos se estivesse clonando e re-adicionar
        const newToggleBtn = toggleBtnEl.cloneNode(true);
        toggleBtnEl.parentNode.replaceChild(newToggleBtn, toggleBtnEl);

        newToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.innerWidth <= 768) {
                // Comportamento mobile (slide idêntico ao class-lecture)
                sidebarEl.classList.toggle('mobile-active');
                overlay.classList.toggle('active');
                document.body.style.overflow = sidebarEl.classList.contains('mobile-active') ? 'hidden' : '';
            } else {
                // Comportamento desktop (colapsar barra lateral, se existir regra no CSS)
                if (sidebarEl.classList.contains('collapsed')) {
                    sidebarEl.classList.remove('collapsed');
                } else {
                    sidebarEl.classList.add('collapsed');
                }
            }
        });

        // Fechar ao clicar no overlay
        overlay.addEventListener('click', () => {
            sidebarEl.classList.remove('mobile-active');
            overlay.classList.remove('active');
            document.body.style.overflow = '';
        });
        
        // Fechar se apertar ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sidebarEl.classList.contains('mobile-active')) {
                sidebarEl.classList.remove('mobile-active');
                overlay.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    }
});








