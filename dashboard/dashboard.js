const menuBtn = document.getElementById("menuBtn");

const sidebar = document.querySelector(".sidebar");

const overlay = document.getElementById("overlay");



menuBtn.addEventListener("click",()=>{


    sidebar.classList.toggle("active");

    overlay.classList.toggle("active");


});



overlay.addEventListener("click",()=>{


    sidebar.classList.remove("active");

    overlay.classList.remove("active");


});