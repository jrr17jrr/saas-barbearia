const sales = document
.getElementById("salesChart");


new Chart(sales, {

    type:"line",

    data:{

        labels:[
            "Seg",
            "Ter",
            "Qua",
            "Qui",
            "Sex",
            "Sáb",
            "Dom"
        ],

        datasets:[{

            label:"Faturamento",

            data:[
                400,
                700,
                550,
                900,
                1200,
                1500,
                800
            ],

            borderWidth:3,

            tension:0.4

        }]

    },


    options:{

        responsive:true,

        plugins:{

            legend:{
                display:false
            }

        }

    }

});





const appointments = document
.getElementById("appointmentsChart");


new Chart(appointments, {


type:"bar",


data:{


labels:[

"Seg",
"Ter",
"Qua",
"Qui",
"Sex",
"Sáb",
"Dom"

],


datasets:[{

label:"Agendamentos",

data:[

12,
18,
15,
22,
30,
35,
20

],

borderWidth:1

}]


},


options:{

responsive:true,

plugins:{

legend:{
display:false
}

}

}


});

const menuBtn = document.getElementById("menuBtn");

const sidebar = document.getElementById("sidebar");

const overlay = document.getElementById("overlay");


menuBtn.addEventListener("click",()=>{

    sidebar.classList.toggle("open");

    overlay.classList.toggle("show");

});


overlay.addEventListener("click",()=>{

    sidebar.classList.remove("open");

    overlay.classList.remove("show");

});