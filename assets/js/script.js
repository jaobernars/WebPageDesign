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








